import { sql } from "./db";
import type { SessionUser } from "./auth";
import { canReadAll } from "./auth";
import { hasModule, hasModuleRole } from "./modules";
import { getTenantUserIds } from "./scope";
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

/**
 * Route a project upload (PO / BOQ / file) to the presales side.
 *
 * The RFQ lead anchored to the project tells us who owns the presales
 * work: if it's already claimed, ping that person; if it's still
 * unclaimed, fan out to the presales manager(s) so they can forward it
 * (or claim it). Uploads on a project with no RFQ are left alone — there
 * is no presales relationship to route them to. Callers wrap this in
 * try/catch so a notification hiccup never fails the upload itself.
 */
export async function notifyPresalesOfProjectUpload(args: {
  projectId: number;
  uploaderId: number;
  /** Human label for the artifact: "PO", "BOQ", or "file". */
  label: string;
  filename?: string | null;
}): Promise<void> {
  const { projectId, uploaderId, label } = args;
  if (!Number.isFinite(projectId) || projectId <= 0) return;
  const q = sql();

  const leadRows = (await q`
    select id, ref, assigned_to_id
    from leads
    where project_id = ${projectId} and deleted_at is null
    order by created_at desc
    limit 1
  `) as Array<{ id: number; ref: string; assigned_to_id: number | null }>;
  const lead = leadRows[0];
  if (!lead) return; // no RFQ → nothing to route to presales

  const projRows = (await q`
    select p.name, p.folder_id, cf.company_id
    from projects p
    join client_folders cf on cf.id = p.folder_id
    where p.id = ${projectId}
    limit 1
  `) as Array<{ name: string; folder_id: number; company_id: number | null }>;
  const proj = projRows[0];
  const projectName = proj?.name ?? `project #${projectId}`;
  const link = proj
    ? proj.company_id
      ? `/crm/company/${proj.company_id}/clients/${proj.folder_id}/${projectId}/quotations`
      : `/crm/individual/${proj.folder_id}/${projectId}/quotations`
    : undefined;
  const fileBit = args.filename ? ` (${args.filename})` : "";

  // Claimed → straight to the presales person working this RFQ.
  if (lead.assigned_to_id) {
    if (lead.assigned_to_id === uploaderId) return; // their own upload
    await sendLeadMessage({
      leadId: lead.id,
      senderId: uploaderId,
      recipientId: lead.assigned_to_id,
      kind: "file_uploaded",
      subject: `${label} uploaded · ${projectName}`,
      body: `A new ${label}${fileBit} was uploaded for ${projectName}.\n\nRFQ: ${lead.ref}`,
      link,
    });
    return;
  }

  // Still unclaimed → ask the presales manager(s) to forward / claim it.
  const managers = (await q`
    select distinct user_id from user_module_roles
    where module = 'crm' and role = 'presales_manager' and revoked_at is null
  `) as Array<{ user_id: number }>;
  for (const m of managers) {
    if (m.user_id === uploaderId) continue;
    await sendLeadMessage({
      leadId: lead.id,
      senderId: uploaderId,
      recipientId: m.user_id,
      kind: "file_uploaded",
      subject: `${label} needs a presales owner · ${projectName}`,
      body:
        `A new ${label}${fileBit} was uploaded for ${projectName}, but no ` +
        `presales has claimed it yet. Forward it to someone — or claim it.\n\nRFQ: ${lead.ref}`,
      link,
    });
  }
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
  /**
   * The requester's tenant user ids. Even a `full` (shared-queue) viewer only
   * sees leads created by a user in their own tenant, never the global queue.
   * In a single-tenant DB this is every user (unchanged).
   */
  tenantUserIds: number[];
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
    tenantUserIds: await getTenantUserIds(user.id),
  };
}

/**
 * The active RFQ (lead) for a project, in the exact shape
 * RequestQuotationButton renders — so the server page can seed the button's
 * first paint instead of letting it flash "Request for Quotation" and then
 * swap to "View quotation" once a client `/api/leads` round-trip lands.
 *
 * Mirrors the selection `/api/leads` makes: prefer a lead that already has a
 * quotation, else the most recent open one. Matches the project on EITHER
 * side of a claim (`project_id` OR `sales_project_id`) and respects the same
 * visibility (the salesperson sees the lead they opened; presales / admin see
 * the shared queue).
 */
export interface ActiveRfq {
  id: number;
  ref: string;
  status: string;
  assigned_to_username: string | null;
  quote_id: number | null;
  quote_ref: string | null;
}

export async function getActiveRfqForProject(
  user: SessionUser,
  projectId: number,
): Promise<ActiveRfq | null> {
  if (!Number.isFinite(projectId) || projectId <= 0) return null;
  const vis = await getLeadVisibility(user);
  const q = sql();
  const rows = (await q`
    select l.id, l.ref, l.status, au.username as assigned_to_username,
           ql.id as quote_id, ql.ref as quote_ref
    from leads l
    left join users au on au.id = l.assigned_to_id
    left join lateral (
      select qq.id, qq.ref
      from quotations qq
      where qq.project_id = l.project_id and qq.deleted_at is null
      order by qq.created_at desc
      limit 1
    ) ql on true
    where l.deleted_at is null
      and (l.project_id = ${projectId} or l.sales_project_id = ${projectId})
      and l.completed_at is null
      and (
        (${vis.full}::boolean and l.created_by = any(${vis.tenantUserIds}::int[]))
        or l.created_by = ${vis.userId}
        or l.assigned_to_id = ${vis.userId}
      )
    order by
      case when ql.id is not null then 0 else 1 end,
      l.created_at desc
    limit 1
  `) as ActiveRfq[];
  return rows[0] ?? null;
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
