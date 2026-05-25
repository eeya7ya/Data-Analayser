import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canPushToExecution, logLeadEvent, sendLeadMessage } from "@/lib/leads";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/push-to-execution
 *
 * Sales hands a received quotation to the projects team. Instead of
 * picking a specific engineer, this raises a project handoff (the same
 * record the "Convert to Project" button creates) so the lead's BOQ lands
 * in the project managers' queue at /projects/handoffs, where a PM
 * assigns a technician / engineer. The lead advances to
 * `sent_to_execution`.
 *
 * Allowed from `quotation_sent` or `won`. Requires a linked quotation.
 * Only sales / sales_manager / admin.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    if (!(await canPushToExecution(user))) {
      return NextResponse.json(
        { error: "only sales can push a deal to execution" },
        { status: 403 },
      );
    }
    const { id } = await ctx.params;
    const leadId = Number(id);
    if (!Number.isFinite(leadId) || leadId <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as {
      priority?: string;
      notes?: string;
    };

    const q = sql();
    const leadRows = (await q`
      select id, ref, title, status, quotation_id, contact_id
      from leads where id = ${leadId} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      title: string;
      status: string;
      quotation_id: number | null;
    }>;
    if (leadRows.length === 0) {
      return NextResponse.json({ error: "lead not found" }, { status: 404 });
    }
    const lead = leadRows[0];
    if (lead.status !== "quotation_sent" && lead.status !== "won") {
      return NextResponse.json(
        { error: `cannot push to execution from status "${lead.status}"` },
        { status: 409 },
      );
    }
    if (!lead.quotation_id) {
      return NextResponse.json(
        { error: "this lead has no quotation to hand over" },
        { status: 409 },
      );
    }

    const qrows = (await q`
      select id, ref, project_name, client_name, client_phone,
             items_json, folder_id, project_id
      from quotations where id = ${lead.quotation_id} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      project_name: string;
      client_name: string | null;
      client_phone: string | null;
      items_json: unknown;
      folder_id: number | null;
      project_id: number | null;
    }>;
    if (qrows.length === 0) {
      return NextResponse.json(
        { error: "linked quotation not found" },
        { status: 404 },
      );
    }
    const quotation = qrows[0];

    const priority = ["low", "normal", "high", "urgent"].includes(
      String(body.priority),
    )
      ? (body.priority as string)
      : "normal";
    const notes = (body.notes || "").trim() || null;
    const boqSnapshot = JSON.stringify(
      Array.isArray(quotation.items_json) ? quotation.items_json : [],
    );

    const inserted = (await q`
      insert into project_handoffs
        (quotation_id, project_id, folder_id, created_by, contact_name,
         contact_phones, priority, notes, boq_snapshot)
      values
        (${quotation.id}, ${quotation.project_id}, ${quotation.folder_id},
         ${user.id}, ${quotation.client_name}, ${quotation.client_phone},
         ${priority}, ${notes}, ${boqSnapshot}::jsonb)
      returning id
    `) as Array<{ id: number }>;
    const handoffId = inserted[0].id;

    await q`
      update leads
      set status = 'sent_to_execution', sent_to_execution_at = now(),
          project_id = coalesce(project_id, ${quotation.project_id}),
          updated_at = now()
      where id = ${leadId}
    `;

    await logLeadEvent(
      leadId,
      user.id,
      "sent_to_execution",
      `Pushed to execution — handoff #${handoffId} raised for the projects team`,
      { handoff_id: handoffId, quotation_id: quotation.id },
    );

    // Notify project managers + admins that there's a handoff to assign.
    const managers = (await q`
      select distinct user_id from user_module_roles
      where module = 'projects' and role = 'manager' and revoked_at is null
    `) as Array<{ user_id: number }>;
    const admins = (await q`
      select id as user_id from users where role = 'admin'
    `) as Array<{ user_id: number }>;
    const recipients = new Set<number>();
    for (const m of managers) recipients.add(m.user_id);
    for (const a of admins) recipients.add(a.user_id);
    for (const rid of recipients) {
      await sendLeadMessage({
        leadId,
        senderId: user.id,
        recipientId: rid,
        kind: "boq_sent_to_execution",
        subject: `[Lead ${lead.ref}] New project to assign — ${lead.title}`,
        body:
          `${user.display_name || user.username} pushed this deal to execution.\n\n` +
          `Quotation: ${quotation.ref} — ${quotation.project_name}\n` +
          "Open Projects → Handoffs to assign a technician / engineer.",
        link: "/projects/handoffs",
      });
    }
    void sendPushToUsers([...recipients], {
      title: "New project to assign",
      body: `${lead.title} — assign a technician/engineer in Projects → Handoffs.`,
      url: "/projects/handoffs",
      tag: `handoff-${handoffId}`,
    });

    return NextResponse.json({
      ok: true,
      status: "sent_to_execution",
      handoff_id: handoffId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
