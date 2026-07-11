import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { hasModuleRole, requireModuleAllowLegacy } from "@/lib/modules";
import { sendPushToUsers } from "@/lib/push";
import { transferHeldQuotation } from "@/lib/holds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * V1.3D — a salesperson records the client outcome on a quotation:
 *
 *   • accepted — the client accepted (Won).
 *   • rejected — the client passed (Lost); a reason is recorded.
 *   • held     — Held for Execution; an optional `hold_transfer_at`
 *                schedules the auto-transfer to the projects team. If the
 *                scheduled time is already past, we transfer immediately.
 *
 * This is the salesperson's verdict on the deal — distinct from the
 * manager approval reject (`rejected_at`), which is about sign-off. Both
 * "accepted" and "held" require an approved quotation (you can't execute
 * something presales hasn't signed off); "rejected" can be marked anytime.
 */

const OUTCOMES = ["accepted", "rejected", "held"] as const;
type Outcome = (typeof OUTCOMES)[number];

async function canMarkOutcome(userId: number, role: string): Promise<boolean> {
  if (role === "admin" || role === "viewer") return true;
  if (await hasModuleRole(userId, "crm", "sales")) return true;
  if (await hasModuleRole(userId, "crm", "sales_manager")) return true;
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireModuleAllowLegacy(user, "crm");

    if (!(await canMarkOutcome(user.id, user.role))) {
      return NextResponse.json(
        { error: "only sales users can mark a quotation outcome" },
        { status: 403 },
      );
    }

    const body = (await req.json()) as {
      id?: number;
      outcome?: string;
      reason?: string | null;
      hold_transfer_at?: string | null;
    };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }
    const outcome = (OUTCOMES as readonly string[]).includes(String(body.outcome))
      ? (body.outcome as Outcome)
      : null;
    if (!outcome) {
      return NextResponse.json(
        { error: "outcome must be accepted, rejected, or held" },
        { status: 400 },
      );
    }

    const q = sql();
    const rows = (await q`
      select id, ref, owner_id, project_id, approved_at, transferred_at,
             sent_to_sales_to, sales_accepted_by, sent_to_sales_at,
             completed_at
      from quotations
      where id = ${id} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      owner_id: number | null;
      project_id: number | null;
      approved_at: string | null;
      transferred_at: string | null;
      sent_to_sales_to: number | null;
      sales_accepted_by: number | null;
      sent_to_sales_at: string | null;
      completed_at: string | null;
    }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const quotation = rows[0];

    const isAdmin = canReadAll(user);
    const isSalesManager =
      isAdmin || (await hasModuleRole(user.id, "crm", "sales_manager"));
    // The presales author owns the quotation row, but the deal verdict is the
    // salesperson's call. Besides the owner, the salesperson the quotation was
    // SENT to (sent_to_sales_to / whoever filed it) may mark the outcome — it
    // is literally their deal to close — as may the salesperson who raised the
    // RFQ for this quotation's project. This is what makes Win / Lost / Hold
    // reachable for plain sales.
    const isRecipient =
      quotation.sent_to_sales_to === user.id ||
      quotation.sales_accepted_by === user.id;
    let raisedRfq = false;
    if (!isAdmin && !isSalesManager && !isRecipient && quotation.owner_id !== user.id) {
      const leadRows = (await q`
        select 1 from leads
        where deleted_at is null and created_by = ${user.id}
          and (
            quotation_id = ${id}
            or (${quotation.project_id}::int is not null and (
              project_id = ${quotation.project_id}
              or sales_project_id = ${quotation.project_id}
            ))
          )
        limit 1
      `) as Array<{ "?column?": number }>;
      raisedRfq = leadRows.length > 0;
    }
    if (
      !isAdmin &&
      !isSalesManager &&
      !isRecipient &&
      quotation.owner_id !== user.id &&
      !raisedRfq
    ) {
      // Plain salespeople may mark outcomes on quotations they own, received
      // via "Send to sales", OR raised the RFQ for. Managers / admins can
      // mark any.
      return NextResponse.json(
        { error: "you can only mark outcomes on quotations sent to you or raised by you" },
        { status: 403 },
      );
    }

    if (quotation.transferred_at) {
      return NextResponse.json(
        { error: "this quotation was already transferred to the projects team" },
        { status: 409 },
      );
    }
    if (quotation.completed_at) {
      return NextResponse.json(
        { error: "this deal was already marked completed" },
        { status: 409 },
      );
    }

    // A deal is decidable once it reached sales: either the legacy manager
    // sign-off (`approved_at`) or the presales "Send to sales" handoff
    // (`sent_to_sales_at`). Nothing in the current flow stamps `approved_at`
    // anymore, so requiring it alone made Win/Hold permanently unreachable.
    if (
      (outcome === "accepted" || outcome === "held") &&
      !quotation.approved_at &&
      !quotation.sent_to_sales_at
    ) {
      return NextResponse.json(
        { error: "the quotation must be sent to sales (or approved) before it can be won or held" },
        { status: 409 },
      );
    }

    const reason =
      outcome === "rejected"
        ? String(body.reason || "").trim().slice(0, 2000) || null
        : null;
    // Losing a deal always carries a justification — the whole point of
    // recording the loss is knowing why.
    if (outcome === "rejected" && !reason) {
      return NextResponse.json(
        { error: "a reason is required to mark the deal as lost" },
        { status: 400 },
      );
    }

    // Only a held quotation carries a transfer schedule. Anything
    // unparseable becomes null = manual-only.
    let holdTransferAt: string | null = null;
    if (outcome === "held" && body.hold_transfer_at) {
      const d = new Date(body.hold_transfer_at);
      if (!Number.isNaN(d.getTime())) holdTransferAt = d.toISOString();
    }
    // `accepted_at` mirrors the outcome so the approval bar's existing
    // "Client accepted" pill keeps working without a second source of truth.
    const acceptedAt = outcome === "accepted" ? new Date().toISOString() : null;

    // Winning / holding a sent-to-sales deal also stamps `approved_at` (when
    // missing) so the downstream execution gates — transfer-hold, the hold
    // sweep and the project-handoff convert — all of which still require an
    // approved quotation, accept it without a separate sign-off step.
    const stampApproval = outcome === "accepted" || outcome === "held";
    await q`
      update quotations
      set sales_outcome = ${outcome},
          sales_outcome_at = now(),
          sales_outcome_by = ${user.id},
          sales_outcome_reason = ${reason},
          hold_transfer_at = ${holdTransferAt},
          accepted_at = ${acceptedAt},
          approved_at = case when ${stampApproval}::boolean
                             then coalesce(approved_at, now())
                             else approved_at end,
          updated_at = now()
      where id = ${id}
    `;
    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'quotation', ${id}, ${"outcome_" + outcome},
              ${JSON.stringify({ outcome, hold_transfer_at: holdTransferAt, reason })}::jsonb)
    `;

    // Keep the presales author in the loop on the deal result.
    if (quotation.owner_id && quotation.owner_id !== user.id) {
      const label =
        outcome === "accepted"
          ? "accepted by the client"
          : outcome === "rejected"
            ? "rejected by the client"
            : "held for execution";
      void sendPushToUsers([quotation.owner_id], {
        title: `${quotation.ref} ${label}`,
        body: reason ? reason.slice(0, 140) : `Marked by ${user.display_name || user.username}.`,
        url: `/quotation?id=${id}`,
        tag: `outcome-${id}`,
      });
    }

    // If the schedule is already past (or set to "now"), transfer straight
    // away rather than waiting for the next lazy sweep.
    let transferredHandoffId: number | null = null;
    if (outcome === "held" && holdTransferAt && new Date(holdTransferAt) <= new Date()) {
      transferredHandoffId = await transferHeldQuotation(q, id, user.id);
    }

    return NextResponse.json({
      ok: true,
      outcome,
      transferred: Boolean(transferredHandoffId),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
