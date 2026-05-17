import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  canDecideOutcome,
  canTransition,
  logLeadEvent,
  sendLeadMessage,
} from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/outcome
 *
 * Sales marks the lead as Won or Lost.
 *
 *   Won  → status moves to `won`. The assigned presales user is pinged
 *          to upload a BOQ. The presales manager is also pinged so they
 *          can route the BOQ to a project user once it's ready.
 *   Lost → status moves to `lost`. Workflow is terminal — the assigned
 *          presales user is notified.
 *
 * Body: { outcome: "won" | "lost", reason?: string }
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    if (!(await canDecideOutcome(user))) {
      return NextResponse.json(
        { error: "only sales users can decide a lead outcome" },
        { status: 403 },
      );
    }

    const { id } = await ctx.params;
    const leadId = Number(id);
    if (!Number.isFinite(leadId) || leadId <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const body = (await req.json()) as { outcome?: string; reason?: string };
    const outcome = String(body.outcome ?? "").toLowerCase();
    if (outcome !== "won" && outcome !== "lost") {
      return NextResponse.json(
        { error: 'outcome must be "won" or "lost"' },
        { status: 400 },
      );
    }

    const q = sql();
    const leadRows = (await q`
      select id, ref, title, status, assigned_to_id, presales_manager_id, created_by
      from leads where id = ${leadId} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      title: string;
      status: string;
      assigned_to_id: number | null;
      presales_manager_id: number | null;
      created_by: number | null;
    }>;
    if (leadRows.length === 0) {
      return NextResponse.json({ error: "lead not found" }, { status: 404 });
    }
    const lead = leadRows[0];

    if (lead.status !== "quotation_sent") {
      return NextResponse.json(
        {
          error: `cannot set outcome from status "${lead.status}" — quotation must be submitted to sales first`,
        },
        { status: 409 },
      );
    }
    if (!canTransition("quotation_sent", outcome as "won" | "lost")) {
      return NextResponse.json({ error: "transition not allowed" }, { status: 409 });
    }

    const reason = body.reason?.trim() ?? null;
    await q`
      update leads
      set outcome = ${outcome},
          outcome_by = ${user.id},
          outcome_at = now(),
          outcome_reason = ${reason},
          status = ${outcome},
          updated_at = now()
      where id = ${leadId}
    `;

    await logLeadEvent(
      leadId,
      user.id,
      `outcome_${outcome}`,
      outcome === "won"
        ? `Sales marked WON${reason ? ` — ${reason}` : ""}`
        : `Sales marked LOST${reason ? ` — ${reason}` : ""}`,
      { outcome, reason },
    );

    // Notify the assigned presales user and the presales manager. On
    // Won, we ask them to upload the BOQ. On Lost, we just close the loop.
    const subjectWon = `[Lead ${lead.ref}] WON — please upload the BOQ`;
    const subjectLost = `[Lead ${lead.ref}] Lost — no further action`;
    const bodyWon =
      `Sales (${user.display_name || user.username}) marked this lead as WON.\n\n` +
      (reason ? `Reason / notes: ${reason}\n\n` : "") +
      `Next step: upload the Bill of Quantities (BOQ) on the lead, then the presales manager will route it to a project engineer to start execution.`;
    const bodyLost =
      `Sales (${user.display_name || user.username}) marked this lead as LOST.\n\n` +
      (reason ? `Reason / notes: ${reason}\n\n` : "") +
      `The lead is now closed.`;

    const recipientIds = new Set<number>();
    if (lead.assigned_to_id) recipientIds.add(lead.assigned_to_id);
    if (lead.presales_manager_id) recipientIds.add(lead.presales_manager_id);
    if (lead.created_by && lead.created_by !== user.id) {
      recipientIds.add(lead.created_by);
    }
    // Always make sure at least one presales manager is informed so the
    // workflow can be moved forward even if the assigned user is away.
    const managers = (await q`
      select user_id from user_module_roles
      where module = 'crm' and role = 'presales_manager' and revoked_at is null
    `) as Array<{ user_id: number }>;
    for (const m of managers) recipientIds.add(m.user_id);

    for (const rid of recipientIds) {
      if (rid === user.id) continue; // don't ping yourself
      await sendLeadMessage({
        leadId,
        senderId: user.id,
        recipientId: rid,
        kind: outcome === "won" ? "won" : "lost",
        subject: outcome === "won" ? subjectWon : subjectLost,
        body: outcome === "won" ? bodyWon : bodyLost,
      });
    }

    return NextResponse.json({ ok: true, status: outcome });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
