import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  canSendToExecution,
  logLeadEvent,
  sendLeadMessage,
} from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/send-to-execution
 *
 * Presales manager hands the won lead + its BOQ to a specific
 * projects-module user to begin execution.
 *
 *   Body: {
 *     execution_assignee_id: number,
 *     role?: "technical" | "engineer" | "manager",  // default 'engineer'
 *     subject?: string,
 *     body?: string,
 *   }
 *
 * Behaviour:
 *   • Validates the assignee actually holds a projects-module role.
 *   • Stamps execution_assignee_id + sent_to_execution_at on the lead.
 *   • Status moves to `sent_to_execution`.
 *   • Mirrors the assignment into project_assignments so the project
 *     surfaces this engineer on the Projects → Roster panel. Existing
 *     project_assignments row (same project_id + user_id + role) is
 *     un-archived; otherwise a fresh row is inserted.
 *   • Sends the execution user a lead_message with the BOQ filename.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    if (!(await canSendToExecution(user))) {
      return NextResponse.json(
        { error: "only presales managers can route to execution" },
        { status: 403 },
      );
    }
    const { id } = await ctx.params;
    const leadId = Number(id);
    if (!Number.isFinite(leadId) || leadId <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    const body = (await req.json()) as {
      execution_assignee_id?: number;
      role?: string;
      subject?: string;
      body?: string;
    };
    const assigneeId = Number(body.execution_assignee_id);
    if (!Number.isInteger(assigneeId) || assigneeId <= 0) {
      return NextResponse.json(
        { error: "execution_assignee_id is required" },
        { status: 400 },
      );
    }
    const role = ["technical", "engineer", "manager"].includes(
      String(body.role ?? ""),
    )
      ? (body.role as "technical" | "engineer" | "manager")
      : "engineer";

    const q = sql();
    const leadRows = (await q`
      select id, ref, title, status, project_id, boq_file_id, assigned_to_id
      from leads where id = ${leadId} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      title: string;
      status: string;
      project_id: number | null;
      boq_file_id: number | null;
      assigned_to_id: number | null;
    }>;
    if (leadRows.length === 0) {
      return NextResponse.json({ error: "lead not found" }, { status: 404 });
    }
    const lead = leadRows[0];

    if (lead.status !== "boq_in_progress" && lead.status !== "won") {
      return NextResponse.json(
        {
          error: `cannot route to execution from status "${lead.status}" — BOQ must be uploaded first`,
        },
        { status: 409 },
      );
    }
    if (!lead.project_id) {
      return NextResponse.json(
        {
          error:
            "lead has no project_id — upload the BOQ first so a project can be attached",
        },
        { status: 409 },
      );
    }

    // Assignee must hold a projects-module role.
    const assigneeRoles = (await q`
      select role from user_module_roles
      where user_id = ${assigneeId} and module = 'projects' and revoked_at is null
    `) as Array<{ role: string }>;
    const hasProjectsRole = assigneeRoles.some((r) =>
      ["technical", "engineer", "manager"].includes(r.role),
    );
    if (!hasProjectsRole) {
      const adminRow = (await q`
        select id from users where id = ${assigneeId} and role = 'admin'
      `) as Array<{ id: number }>;
      if (adminRow.length === 0) {
        return NextResponse.json(
          {
            error:
              "assignee must hold a projects-module role (technical / engineer / manager)",
          },
          { status: 400 },
        );
      }
    }

    const newStatus = "sent_to_execution";
    await q`
      update leads
      set execution_assignee_id = ${assigneeId},
          sent_to_execution_at = now(),
          status = ${newStatus},
          updated_at = now()
      where id = ${leadId}
    `;

    // Mirror into project_assignments. Same un-archive-then-insert
    // pattern used by /api/project-assignments so manager re-routes
    // don't create duplicate active rows.
    await q`
      update project_assignments
      set deleted_at = null
      where project_id = ${lead.project_id}
        and user_id = ${assigneeId}
        and role = ${role}
        and deleted_at is not null
    `;
    const existing = (await q`
      select id from project_assignments
      where project_id = ${lead.project_id}
        and user_id = ${assigneeId}
        and role = ${role}
        and deleted_at is null
      limit 1
    `) as Array<{ id: number }>;
    if (existing.length === 0) {
      await q`
        insert into project_assignments
          (project_id, user_id, role, assigned_by, notes)
        values
          (${lead.project_id}, ${assigneeId}, ${role}, ${user.id},
           ${`Routed from Lead ${lead.ref}`})
      `;
    }

    // Look up the BOQ filename (if any) for the notification body.
    let boqFilename: string | null = null;
    if (lead.boq_file_id) {
      const rows = (await q`
        select filename from project_files where id = ${lead.boq_file_id}
      `) as Array<{ filename: string }>;
      boqFilename = rows[0]?.filename ?? null;
    }

    await logLeadEvent(
      leadId,
      user.id,
      "sent_to_execution",
      `Routed to execution: user #${assigneeId} as ${role}`,
      {
        execution_assignee_id: assigneeId,
        role,
        project_id: lead.project_id,
        boq_file_id: lead.boq_file_id,
      },
    );

    const assigneeRow = (await q`
      select username, display_name from users where id = ${assigneeId}
    `) as Array<{ username: string; display_name: string | null }>;
    const assigneeLabel =
      assigneeRow[0]?.display_name || assigneeRow[0]?.username || "the engineer";

    const subject =
      body.subject?.trim() ||
      `[Lead ${lead.ref}] Execution handoff — ${lead.title}`;
    const bodyText =
      body.body?.trim() ||
      `${user.display_name || user.username} routed this lead to you for execution.\n\n` +
        `Lead: ${lead.title}\n` +
        `Project: #${lead.project_id}\n` +
        (boqFilename ? `BOQ file: ${boqFilename}\n\n` : "\n") +
        `You've been added to the project roster as ${role}. ` +
        `Open the lead to view the BOQ and start work, then mark the lead complete when execution is finished.`;

    await sendLeadMessage({
      leadId,
      senderId: user.id,
      recipientId: assigneeId,
      kind: "boq_sent_to_execution",
      subject,
      body: bodyText,
    });

    // Courtesy CC the original presales user (if different).
    if (lead.assigned_to_id && lead.assigned_to_id !== assigneeId) {
      await sendLeadMessage({
        leadId,
        senderId: user.id,
        recipientId: lead.assigned_to_id,
        kind: "general",
        subject: `[Lead ${lead.ref}] Routed to ${assigneeLabel} for execution`,
        body:
          `Your work on this lead is complete — it's been handed to ${assigneeLabel} (${role}) for execution.\n\n` +
          `You'll still see read-only progress on the lead page.`,
      });
    }

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
