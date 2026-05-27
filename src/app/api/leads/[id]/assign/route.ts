import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  canTriageLeads,
  canTransition,
  logLeadEvent,
  sendLeadMessage,
} from "@/lib/leads";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/assign
 *
 * Presales manager distributes the lead: picks a presales user from the
 * dropdown (`assignee_id`) and routes it to them. This is the lead's only
 * job — status moves from `new` → `distributed` (terminal) and a
 * lead_message lands in the presales user's inbox.
 *
 * Body: { assignee_id: number, note?: string }
 *
 * A lead that's already `distributed` can be RE-DISTRIBUTED by an admin or
 * presales manager (same role gate); the new assignee replaces the
 * previous one and the timeline records both.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    if (!(await canTriageLeads(user))) {
      return NextResponse.json(
        { error: "only presales managers can assign leads" },
        { status: 403 },
      );
    }

    const { id } = await ctx.params;
    const leadId = Number(id);
    if (!Number.isFinite(leadId) || leadId <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    const body = (await req.json()) as {
      assignee_id?: number;
      note?: string;
      requested_timeline_at?: string | null;
    };
    const assigneeId = Number(body.assignee_id);
    // Presales owns its own turnaround: the manager optionally sets the
    // response-by date when distributing. `null`/empty leaves whatever's
    // already on the lead untouched (see the coalesce in the UPDATE).
    const respondBy =
      typeof body.requested_timeline_at === "string" &&
      body.requested_timeline_at.trim()
        ? body.requested_timeline_at.trim()
        : null;
    if (!Number.isInteger(assigneeId) || assigneeId <= 0) {
      return NextResponse.json(
        { error: "assignee_id is required" },
        { status: 400 },
      );
    }

    const q = sql();
    const leadRows = (await q`
      select id, ref, title, status, assigned_to_id
      from leads where id = ${leadId} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      title: string;
      status: string;
      assigned_to_id: number | null;
    }>;
    if (leadRows.length === 0) {
      return NextResponse.json({ error: "lead not found" }, { status: 404 });
    }
    const lead = leadRows[0];

    // A lead can be distributed from `new`, or re-distributed while
    // already `distributed` (a manager changing their mind).
    if (lead.status !== "new" && lead.status !== "distributed") {
      return NextResponse.json(
        {
          error: `cannot distribute a lead in status "${lead.status}"`,
        },
        { status: 409 },
      );
    }

    // Validate the assignee actually has a presales role.
    const assigneeRoles = (await q`
      select role from user_module_roles
      where user_id = ${assigneeId} and module = 'crm' and revoked_at is null
    `) as Array<{ role: string }>;
    const isPresales = assigneeRoles.some(
      (r) => r.role === "presales" || r.role === "presales_manager",
    );
    if (!isPresales) {
      // Also accept admins as a fallback — they may be filling in.
      const adminRow = (await q`
        select id from users where id = ${assigneeId} and role = 'admin'
      `) as Array<{ id: number }>;
      if (adminRow.length === 0) {
        return NextResponse.json(
          { error: "assignee must hold crm.presales or crm.presales_manager" },
          { status: 400 },
        );
      }
    }

    const willTransition = lead.status === "new";
    if (willTransition && !canTransition("new", "distributed")) {
      // Defensive — the map says it's allowed; if anyone tweaks it
      // wrong this catches it before the UPDATE runs.
      return NextResponse.json({ error: "transition not allowed" }, { status: 409 });
    }

    const newStatus = "distributed";
    await q`
      update leads
      set assigned_to_id = ${assigneeId},
          assigned_at    = now(),
          presales_manager_id = ${user.id},
          status         = ${newStatus},
          requested_timeline_at = coalesce(${respondBy}, requested_timeline_at),
          updated_at     = now()
      where id = ${leadId}
    `;

    const assigneeRow = (await q`
      select username, display_name from users where id = ${assigneeId}
    `) as Array<{ username: string; display_name: string | null }>;
    const assigneeLabel =
      assigneeRow[0]?.display_name || assigneeRow[0]?.username || "the presales engineer";

    const verb = lead.assigned_to_id ? "redistributed" : "distributed";
    await logLeadEvent(leadId, user.id, verb, `${verb} to ${assigneeLabel}`, {
      assignee_id: assigneeId,
      previous_assignee_id: lead.assigned_to_id,
      note: body.note ?? null,
    });

    const subject = `[Lead ${lead.ref}] Distributed to you — ${lead.title}`;
    const noteLine = body.note?.trim()
      ? `\n\nNote from presales manager:\n${body.note.trim()}\n`
      : "";
    const bodyText =
      `${user.display_name || user.username} distributed this lead to you.\n\n` +
      `Title: ${lead.title}\n` +
      noteLine +
      `Pick up the work from here in the CRM client area.`;

    await sendLeadMessage({
      leadId,
      senderId: user.id,
      recipientId: assigneeId,
      kind: "lead_assigned",
      subject,
      body: bodyText,
    });

    // If we re-assigned someone else away from the lead, courtesy-ping
    // the previous owner so they know the work is no longer theirs.
    if (lead.assigned_to_id && lead.assigned_to_id !== assigneeId) {
      await sendLeadMessage({
        leadId,
        senderId: user.id,
        recipientId: lead.assigned_to_id,
        kind: "general",
        subject: `[Lead ${lead.ref}] Reassigned away from you`,
        body:
          `${user.display_name || user.username} re-routed this lead to ${assigneeLabel}.\n\n` +
          `No further action required from you.`,
      });
    }

    void sendPushToUsers([assigneeId], {
      title: `Lead distributed to you — ${lead.ref}`,
      body: `${lead.title}. Pick up the work in the CRM client area.`,
      url: `/leads/${leadId}`,
      tag: `lead-distributed-${leadId}`,
    });

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
