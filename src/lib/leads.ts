import { sql } from "./db";
import type { SessionUser } from "./auth";
import { canReadAll } from "./auth";
import { hasModule, hasModuleRole } from "./modules";
import type { LeadStatus, LeadMessageKind } from "./leadConstants";

/**
 * Lead lifecycle SERVER helpers — REF generation, status transitions,
 * event logging, and the local "email" dispatch that powers the inbox.
 *
 * Pure constants / labels live in `./leadConstants` so client components
 * can import them without webpack trying to bundle the `postgres`
 * driver. Anything below this comment block touches the database and
 * must only be imported from server code (route handlers, server
 * components, etc.).
 *
 * 1.4A — the lifecycle is a shared presales queue, no manager hand-off:
 *
 *   new → in_progress
 *
 * Sales opens a lead (information intake); it lands in the shared queue.
 * Any presales person CLAIMS it to start working it (self-assign), which
 * moves it to `in_progress` and records who owns the intake. Each
 * transition emits one `lead_events` row plus a `lead_messages` /
 * `notifications` row so the TopBar bell pings without polling a second
 * feed.
 */

// Re-export the constants so existing server callers keep working.
export {
  LEAD_STATUSES,
  LEAD_PRIORITIES,
  LEAD_MESSAGE_KINDS,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_WAITING_ON,
} from "./leadConstants";
export type { LeadStatus, LeadPriority, LeadMessageKind } from "./leadConstants";

// ── Role gates ────────────────────────────────────────────────────────────

/**
 * Any CRM user can OPEN a lead (the information intake / RFQ): sales as
 * their work cycle, and presales when they capture an inbound enquiry
 * themselves. Either way it lands in the shared queue for a presales
 * person to claim. Admins always pass.
 */
export async function canCreateLead(user: SessionUser): Promise<boolean> {
  if (user.role === "admin") return true;
  return hasModule(user.id, "crm");
}

/**
 * Anyone on presales (member or manager) can claim and work a lead off the
 * shared queue — there is no separate distribution role. Admins always pass.
 */
export async function canClaimLead(user: SessionUser): Promise<boolean> {
  if (user.role === "admin") return true;
  return (
    (await hasModuleRole(user.id, "crm", "presales")) ||
    (await hasModuleRole(user.id, "crm", "presales_manager"))
  );
}

// ── REF generator ─────────────────────────────────────────────────────────

/**
 * Lead reference. Format: `L-<MDDYY>-<n>` where MDDYY follows the same
 * convention used by quotations (month unpadded, day zero-padded, two-
 * digit year). `n` is the global incrementing counter per database,
 * computed from the count of leads created so far + 1. We never reuse
 * numbers from soft-deleted leads — the ref is permanent.
 */
export async function generateLeadRef(): Promise<string> {
  const q = sql();
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const day = String(now.getUTCDate()).padStart(2, "0");
  const year = String(now.getUTCFullYear()).slice(-2);
  const date = `${month}${day}${year}`;

  // Take the highest numeric suffix already in use for today's date and
  // bump by one. If none exist for this date, start at 1. We do this
  // instead of a global counter so two refs from the same day stay
  // visually grouped.
  const rows = (await q`
    select ref from leads
    where ref like ${`L-${date}-%`}
  `) as Array<{ ref: string }>;
  let max = 0;
  for (const r of rows) {
    const parts = r.ref.split("-");
    const n = Number(parts[2]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `L-${date}-${max + 1}`;
}

// ── Activity / messaging ──────────────────────────────────────────────────

export async function logLeadEvent(
  leadId: number,
  actorId: number | null,
  verb: string,
  message: string | null,
  meta?: Record<string, unknown>,
): Promise<void> {
  const q = sql();
  await q`
    insert into lead_events (lead_id, actor_id, verb, message, meta_json)
    values (${leadId}, ${actorId}, ${verb}, ${message},
            ${JSON.stringify(meta ?? {})}::jsonb)
  `;
}

/**
 * Dispatch a local "email" message AND a TopBar notification to the
 * recipient. When real SMTP integration lands, this is the single
 * choke-point that needs to gain a `await sendExternalEmail(...)` call —
 * everything upstream already routes through here.
 */
export async function sendLeadMessage(args: {
  leadId: number | null;
  senderId: number | null;
  recipientId: number;
  kind: LeadMessageKind;
  subject: string;
  body: string;
  link?: string;
}): Promise<number> {
  const q = sql();
  const inserted = (await q`
    insert into lead_messages
      (lead_id, sender_id, recipient_id, kind, subject, body)
    values
      (${args.leadId}, ${args.senderId}, ${args.recipientId}, ${args.kind},
       ${args.subject}, ${args.body})
    returning id
  `) as Array<{ id: number }>;
  const messageId = inserted[0].id;

  await q`
    insert into notifications (user_id, kind, title, body, link, payload)
    values (${args.recipientId}, ${`lead.${args.kind}`}, ${args.subject},
            ${args.body},
            ${args.link ?? (args.leadId ? `/leads/${args.leadId}` : null)},
            ${JSON.stringify({ lead_id: args.leadId, message_id: messageId })}::jsonb)
  `;

  return messageId;
}

// ── Status transition guard ───────────────────────────────────────────────

/**
 * Validate the requested status transition. The allowed-next map is
 * deliberately conservative — UI buttons are role-gated, but the API
 * also rejects out-of-band requests so a stale tab can't fast-forward
 * a lead past a stage that other users haven't seen yet.
 */
const ALLOWED_NEXT: Record<LeadStatus, ReadonlyArray<LeadStatus>> = {
  new: ["in_progress"],
  in_progress: ["new"], // a claimed lead can be released back to the queue
};

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  return ALLOWED_NEXT[from]?.includes(to) ?? false;
}

// ── Visibility scope ──────────────────────────────────────────────────────

export interface LeadVisibility {
  /**
   * Sees the entire shared queue — admin or ANY presales role. Presales
   * need to see every lead (claimed or not, and by whom) so the queue is
   * truly shared and "who's working on it" is visible to the whole team.
   */
  full: boolean;
  /** Sales / sales_manager — sees the leads they opened, to track them. */
  sales: boolean;
  /** True for any presales role (member or manager). */
  presales: boolean;
  /** Effective user id used for assigned_to / created_by filters. */
  userId: number;
}

export async function getLeadVisibility(user: SessionUser): Promise<LeadVisibility> {
  const isAdmin = canReadAll(user);
  const isPresales =
    isAdmin ||
    (await hasModuleRole(user.id, "crm", "presales")) ||
    (await hasModuleRole(user.id, "crm", "presales_manager"));
  const isSales =
    isAdmin ||
    (await hasModuleRole(user.id, "crm", "sales")) ||
    (await hasModuleRole(user.id, "crm", "sales_manager"));

  return {
    full: isAdmin || isPresales,
    sales: isSales,
    presales: isPresales,
    userId: user.id,
  };
}

/**
 * Folder-level access granted *through* a lead. A presales engineer who
 * gets a lead distributed to them (or the salesperson who opened it)
 * doesn't own the client folder it's linked to, so the plain
 * `owner_id = self` check would lock them out of the very workspace the
 * lead asks them to work in. This returns true when the user is the
 * current assignee or the creator of a live lead linked to the folder,
 * so the folder pages can widen access for exactly those people.
 */
export async function userHasLeadAccessToFolder(
  userId: number,
  folderId: number,
): Promise<boolean> {
  const q = sql();
  const rows = (await q`
    select 1 as one from leads
    where folder_id = ${folderId}
      and deleted_at is null
      and (assigned_to_id = ${userId} or created_by = ${userId})
    limit 1
  `) as Array<{ one: number }>;
  return rows.length > 0;
}
