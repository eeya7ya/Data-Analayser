import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { logLeadEvent, sendLeadMessage } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/boq
 *
 * Presales user attaches the BOQ file (already uploaded via the
 * existing /api/project-files two-phase flow) to the won lead.
 *
 *   Body: { boq_file_id: number }
 *
 * The file has to be a project_files row of kind='boq'. We pull the
 * project_id from that row and stamp it on the lead so the eventual
 * execution handoff knows which project to target. Status moves
 * `won` → `boq_in_progress`.
 *
 * Allowed actors: assigned presales user, presales_manager, admin.
 */
export async function POST(
  req: NextRequest,
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

    const body = (await req.json()) as { boq_file_id?: number };
    const fileId = Number(body.boq_file_id);
    if (!Number.isInteger(fileId) || fileId <= 0) {
      return NextResponse.json(
        { error: "boq_file_id is required" },
        { status: 400 },
      );
    }

    const q = sql();
    const leadRows = (await q`
      select id, ref, title, status, assigned_to_id, presales_manager_id
      from leads where id = ${leadId} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      title: string;
      status: string;
      assigned_to_id: number | null;
      presales_manager_id: number | null;
    }>;
    if (leadRows.length === 0) {
      return NextResponse.json({ error: "lead not found" }, { status: 404 });
    }
    const lead = leadRows[0];

    const isAdmin = canReadAll(user);
    const isOwner = lead.assigned_to_id === user.id;
    const isManager = isAdmin
      ? true
      : ((await q`
          select 1 from user_module_roles
          where user_id = ${user.id} and module = 'crm'
            and role = 'presales_manager' and revoked_at is null
          limit 1
        `) as Array<{ "?column?": number }>).length > 0;

    if (!isAdmin && !isOwner && !isManager) {
      return NextResponse.json(
        {
          error:
            "only the assigned presales user or a presales manager can attach a BOQ",
        },
        { status: 403 },
      );
    }

    if (lead.status !== "won" && lead.status !== "boq_in_progress") {
      return NextResponse.json(
        {
          error: `cannot attach BOQ from status "${lead.status}" — sales must mark Won first`,
        },
        { status: 409 },
      );
    }

    const fileRows = (await q`
      select id, project_id, kind, filename
      from project_files where id = ${fileId} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      project_id: number;
      kind: string;
      filename: string;
    }>;
    if (fileRows.length === 0) {
      return NextResponse.json({ error: "BOQ file not found" }, { status: 404 });
    }
    if (fileRows[0].kind !== "boq") {
      return NextResponse.json(
        { error: "the attached file must have kind='boq'" },
        { status: 400 },
      );
    }
    const file = fileRows[0];

    const newStatus = "boq_in_progress";
    await q`
      update leads
      set boq_file_id = ${fileId},
          boq_uploaded_at = now(),
          project_id = ${file.project_id},
          status = ${newStatus},
          updated_at = now()
      where id = ${leadId}
    `;

    await logLeadEvent(
      leadId,
      user.id,
      "boq_uploaded",
      `BOQ attached: ${file.filename}`,
      { boq_file_id: fileId, filename: file.filename, project_id: file.project_id },
    );

    // Ping every presales manager so they can pick a project user.
    const managers = (await q`
      select user_id from user_module_roles
      where module = 'crm' and role = 'presales_manager' and revoked_at is null
    `) as Array<{ user_id: number }>;
    const recipientIds = new Set<number>(managers.map((m) => m.user_id));
    // Make sure the lead's recorded presales manager (if any) is on the list.
    if (lead.presales_manager_id) recipientIds.add(lead.presales_manager_id);

    const subject = `[Lead ${lead.ref}] BOQ ready — please route to execution`;
    const bodyText =
      `${user.display_name || user.username} attached the BOQ for this lead.\n\n` +
      `Lead: ${lead.title}\n` +
      `File: ${file.filename}\n\n` +
      `Open the lead and pick which projects-module engineer / manager will execute it.`;

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

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
