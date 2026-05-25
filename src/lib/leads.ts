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
 * The lifecycle (see migration in /lib/db.ts) is:
 *
 *   new → assigned → in_progress → quotation_sent
 *       → won  → boq_in_progress → sent_to_execution → completed
 *       → lost (terminal)
 *
 * Each transition is guarded by a role/owner check and emits one
 * `lead_events` row plus one or more `lead_messages` to the next
 * responsible user. The message also creates a `notifications` row so
 * the TopBar bell pings without us having to poll a second feed.
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

/** True for anyone holding a CRM role — both sales and presales can open leads. */
export async function canCreateLead(user: SessionUser): Promise<boolean> {
  if (user.role === "admin") return true;
  return hasModule(user.id, "crm");
}

/** Only presales_manager triages the queue. Admins always pass. */
export async function canTriageLeads(user: SessionUser): Promise<boolean> {
  if (user.role === "admin") return true;
  return hasModuleRole(user.id, "crm", "presales_manager");
}

/** Sales / sales_manager are the only ones who can mark won / lost. */
export async function canDecideOutcome(user: SessionUser): Promise<boolean> {
  if (user.role === "admin") return true;
  if (await hasModuleRole(user.id, "crm", "sales_manager")) return true;
  return hasModuleRole(user.id, "crm", "sales");
}

/**
 * V1.3c — sales push the deal to the projects team for execution. This is
 * the same audience as the won/lost decision: a salesperson handling the
 * received quotation chooses hold / mark sold / push to execution.
 */
export async function canPushToExecution(user: SessionUser): Promise<boolean> {
  return canDecideOutcome(user);
}

/**
 * Presales manager signs off the prepared quotation before it's released
 * to sales (V1.3c). Plain presales prepare it; the manager approves.
 */
export async function canSignOffQuotation(user: SessionUser): Promise<boolean> {
  if (user.role === "admin") return true;
  return hasModuleRole(user.id, "crm", "presales_manager");
}

/** Presales_manager picks the project member that receives the BOQ. */
export async function canSendToExecution(user: SessionUser): Promise<boolean> {
  if (user.role === "admin") return true;
  return hasModuleRole(user.id, "crm", "presales_manager");
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
  new: ["assigned"],
  assigned: ["in_progress", "quotation_review", "quotation_sent"],
  // A presales member submits for sign-off (→ quotation_review); a
  // presales manager may release straight to sales (→ quotation_sent).
  in_progress: ["quotation_review", "quotation_sent"],
  // Presales manager either releases to sales or sends it back to the
  // member for rework.
  quotation_review: ["quotation_sent", "in_progress"],
  // Sales: mark won/lost, or push straight to execution (handoff queue).
  quotation_sent: ["won", "lost", "sent_to_execution"],
  won: ["boq_in_progress", "sent_to_execution"],
  lost: [],
  boq_in_progress: ["sent_to_execution"],
  sent_to_execution: ["completed"],
  completed: [],
};

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  return ALLOWED_NEXT[from]?.includes(to) ?? false;
}

// ── Visibility scope ──────────────────────────────────────────────────────

export interface LeadVisibility {
  /** Admin or presales_manager — sees everything. */
  full: boolean;
  /** Sales / sales_manager — sees leads after they're submitted to sales. */
  sales: boolean;
  /** Presales (non-manager) — sees only leads assigned TO them or CREATED by them. */
  ownerOnly: boolean;
  /** Projects-module user — sees leads currently routed to them for execution. */
  execution: boolean;
  /** Effective user id used for assigned_to / created_by / execution filters. */
  userId: number;
}

export async function getLeadVisibility(user: SessionUser): Promise<LeadVisibility> {
  const isAdmin = canReadAll(user);
  const isPresalesManager =
    isAdmin || (await hasModuleRole(user.id, "crm", "presales_manager"));
  const isSalesManager =
    isAdmin || (await hasModuleRole(user.id, "crm", "sales_manager"));
  const isSales = isSalesManager || (await hasModuleRole(user.id, "crm", "sales"));
  const isPresales = isPresalesManager || (await hasModuleRole(user.id, "crm", "presales"));
  const isProjects = isAdmin || (await hasModule(user.id, "projects"));

  return {
    full: isAdmin || isPresalesManager || isSalesManager,
    sales: isSales,
    ownerOnly: isPresales,
    execution: isProjects,
    userId: user.id,
  };
}
