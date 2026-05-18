import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { logLeadEvent, sendLeadMessage } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/complete
 *
 * Marks the lead as complete. Allowed actors:
 *   • The execution_assignee (the project user who received the BOQ).
 *   • Any projects-module manager.
 *   • Admin / presales_manager (admin override / closing on behalf of).
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { id } = await ctx.params;
    const leadId = Number(id);
    if (!Number.isFinite(leadId) || leadId <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    const q = sql();
    const leadRows = (await q`
      select id, ref, title, status, execution_assignee_id, assigned_to_id,
             presales_manager_id, created_by
      from leads where id = ${leadId} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      title: string;
      status: string;
      execution_assignee_id: number | null;
      assigned_to_id: number | null;
      presales_manager_id: number | null;
      created_by: number | null;
    }>;
    if (leadRows.length === 0) {
      return NextResponse.json({ error: "lead not found" }, { status: 404 });
    }
    const lead = leadRows[0];

    if (lead.status !== "sent_to_execution") {
      return NextResponse.json(
        { error: `cannot complete from status "${lead.status}"` },
        { status: 409 },
      );
    }

    const isAdmin = canReadAll(user);
    const isExecutor = lead.execution_assignee_id === user.id;
    let allowed = isAdmin || isExecutor;
    if (!allowed) {
      const rows = (await q`
        select 1 from user_module_roles
        where user_id = ${user.id}
          and (
            (module = 'projects' and role = 'manager')
            or (module = 'crm' and role = 'presales_manager')
          )
          and revoked_at is null
        limit 1
      `) as Array<{ "?column?": number }>;
      allowed = rows.length > 0;
    }
    if (!allowed) {
      return NextResponse.json(
        { error: "only the assigned engineer or a manager can complete this lead" },
        { status: 403 },
      );
    }

    await q`
      update leads
      set status = 'completed',
          completed_at = now(),
          updated_at = now()
      where id = ${leadId}
    `;

    await logLeadEvent(
      leadId,
      user.id,
      "completed",
      "Execution completed",
      {},
    );

    // Loop everyone who had a stake in the lead in on the good news.
    const recipientIds = new Set<number>();
    if (lead.created_by) recipientIds.add(lead.created_by);
    if (lead.assigned_to_id) recipientIds.add(lead.assigned_to_id);
    if (lead.presales_manager_id) recipientIds.add(lead.presales_manager_id);
    if (lead.execution_assignee_id) recipientIds.add(lead.execution_assignee_id);

    const subject = `[Lead ${lead.ref}] Completed — ${lead.title}`;
    const bodyText =
      `${user.display_name || user.username} marked this lead as completed.\n\n` +
      `Lead lifecycle is closed. The lead, the linked quotation, the BOQ and the project all remain on record for audit and re-use.`;

    for (const rid of recipientIds) {
      if (rid === user.id) continue;
      await sendLeadMessage({
        leadId,
        senderId: user.id,
        recipientId: rid,
        kind: "general",
        subject,
        body: bodyText,
      });
    }

    return NextResponse.json({ ok: true, status: "completed" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
