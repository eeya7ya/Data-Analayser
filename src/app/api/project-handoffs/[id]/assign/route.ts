import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { hasModuleRole } from "@/lib/modules";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/project-handoffs/:id/assign
 *
 * Projects manager (or admin) assigns a project member to a pending
 * handoff. Mirrors the assignment into `project_assignments` so the
 * member shows up on the project roster (same un-archive-then-insert
 * pattern as lead send-to-execution), then flips the handoff to
 * `assigned`.
 *
 *   Body: { assigned_user_id: number, role?: "technical"|"engineer"|"manager" }
 */
const ROLES = ["technical", "engineer", "manager"] as const;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();

    const isAdmin = canReadAll(user);
    const isManager =
      isAdmin || (await hasModuleRole(user.id, "projects", "manager"));
    if (!isManager) {
      return NextResponse.json(
        { error: "only projects managers can assign a handoff" },
        { status: 403 },
      );
    }

    const { id } = await ctx.params;
    const handoffId = Number(id);
    if (!Number.isInteger(handoffId) || handoffId <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    const body = (await req.json()) as {
      assigned_user_id?: number;
      role?: string;
      location?: string;
      start_date?: string;
      end_date?: string;
      notes?: string;
    };
    const assigneeId = Number(body.assigned_user_id);
    if (!Number.isInteger(assigneeId) || assigneeId <= 0) {
      return NextResponse.json(
        { error: "assigned_user_id is required" },
        { status: 400 },
      );
    }
    const role = (ROLES as readonly string[]).includes(String(body.role))
      ? (body.role as (typeof ROLES)[number])
      : "engineer";
    const isDate = (s: unknown) =>
      typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const location = body.location?.trim() || null;
    const startDate = isDate(body.start_date) ? (body.start_date as string) : null;
    const endDate = isDate(body.end_date) ? (body.end_date as string) : null;
    const notes =
      body.notes?.trim() || `Assigned from handoff #${handoffId}`;

    const q = sql();
    const rows = (await q`
      select id, project_id, status from project_handoffs
      where id = ${handoffId}
      limit 1
    `) as Array<{ id: number; project_id: number | null; status: string }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "handoff not found" }, { status: 404 });
    }
    const handoff = rows[0];
    if (handoff.status === "completed" || handoff.status === "cancelled") {
      return NextResponse.json(
        { error: `cannot assign a ${handoff.status} handoff` },
        { status: 409 },
      );
    }

    // Assignee must hold a projects-module role (or be an admin).
    const assigneeRoles = (await q`
      select role from user_module_roles
      where user_id = ${assigneeId} and module = 'projects' and revoked_at is null
    `) as Array<{ role: string }>;
    const hasProjectsRole = assigneeRoles.some((r) => ROLES.includes(r.role as never));
    if (!hasProjectsRole) {
      const adminRow = (await q`
        select id from users where id = ${assigneeId} and role = 'admin'
      `) as Array<{ id: number }>;
      if (adminRow.length === 0) {
        return NextResponse.json(
          { error: "assignee must hold a projects-module role (technical / engineer / manager)" },
          { status: 400 },
        );
      }
    }

    // Mirror into project_assignments when a project is attached.
    if (handoff.project_id) {
      await q`
        update project_assignments
        set deleted_at = null
        where project_id = ${handoff.project_id}
          and user_id = ${assigneeId}
          and role = ${role}
          and deleted_at is not null
      `;
      const existing = (await q`
        select id from project_assignments
        where project_id = ${handoff.project_id}
          and user_id = ${assigneeId}
          and role = ${role}
          and deleted_at is null
        limit 1
      `) as Array<{ id: number }>;
      if (existing.length === 0) {
        await q`
          insert into project_assignments
            (project_id, user_id, role, assigned_by, location, start_date, end_date, notes)
          values
            (${handoff.project_id}, ${assigneeId}, ${role}, ${user.id},
             ${location}, ${startDate}, ${endDate}, ${notes})
        `;
      } else {
        await q`
          update project_assignments
          set location = ${location},
              start_date = ${startDate},
              end_date = ${endDate},
              notes = ${notes},
              assigned_by = ${user.id}
          where id = ${existing[0].id}
        `;
      }
    }

    await q`
      update project_handoffs
      set assigned_user_id = ${assigneeId},
          assigned_by = ${user.id},
          assigned_at = now(),
          status = 'assigned',
          updated_at = now()
      where id = ${handoffId}
    `;

    await q`
      insert into syslog (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'project_handoff', ${handoffId}, 'assign',
              ${JSON.stringify({ assigned_user_id: assigneeId, role })}::jsonb)
    `;

    void sendPushToUsers([assigneeId], {
      title: "New project assigned to you",
      body: `You've been assigned as ${role}. Open the handoff for the BOQ, contacts, and site location.`,
      url: "/projects/handoffs",
      tag: `handoff-${handoffId}`,
    });

    return NextResponse.json({ ok: true, status: "assigned" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const s = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status: s });
  }
}
