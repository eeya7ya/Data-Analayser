import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  hasModule,
  hasModuleRole,
  requireCrmClientWrite,
  requireCrmOrProjectsRead,
} from "@/lib/modules";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Project-module assignments.
 *
 * GET ?project_id=X  → assignments for one project (anyone who can see
 *                      the project can read the roster).
 * GET ?user_id=X     → "my work" view — every active assignment held by
 *                      a user. Non-admin callers may only query their
 *                      own user_id; admins may query anyone.
 * POST               → attach a user to a project with a role and an
 *                      optional info window (location, dates, notes).
 *                      Idempotent on (project_id, user_id, role) — re-
 *                      attaching clears any prior soft-delete.
 * PATCH              → soft-revoke (deleted_at = now()) so the audit
 *                      trail of "X worked on Y from … to …" survives.
 *                      Re-POST to re-attach.
 *
 * Auth: admin OR (crm.* for the project's owner — i.e. the same user
 * who can edit the project) OR projects.manager. Engineers and
 * technicals cannot grant assignments to others.
 */

interface AssignmentRow {
  id: number;
  project_id: number;
  user_id: number;
  username: string;
  role: "technical" | "engineer" | "manager";
  assigned_by: number | null;
  assigned_by_username: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  scope_of_work: string | null;
  status: string | null;
  company_name: string | null;
  client_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  created_at: string;
}

async function canManageAssignments(
  userId: number,
  userRole: string,
  projectOwnerId: number | null,
): Promise<boolean> {
  if (userRole === "admin") return true;
  if (projectOwnerId !== null && projectOwnerId === userId) return true;
  if (await hasModuleRole(userId, "projects", "manager")) return true;
  return false;
}

async function canViewProjectRoster(
  userId: number,
  userRole: string,
  projectId: number,
  projectOwnerId: number | null,
): Promise<boolean> {
  if (userRole === "admin") return true;
  if (projectOwnerId !== null && projectOwnerId === userId) return true;
  if (await hasModule(userId, "projects")) {
    // any projects-module user may read the roster of any project they
    // can see; deeper visibility scoping lives in /lib/scope.ts (Phase 4+)
    // and is applied at the list endpoints in /projects pages.
    return true;
  }
  // Non-admin CRM users who own the project hit the owner branch above;
  // anyone else is fenced out.
  void projectId;
  return false;
}

/** Sentinel returned by normSchedDate for a malformed date string. */
const INVALID = Symbol("invalid-date");

/**
 * Normalize a scheduling date for a PATCH: undefined / null → null (clears
 * the field), a strict YYYY-MM-DD string → itself, anything else → INVALID.
 */
function normSchedDate(
  raw: string | null | undefined,
): string | null | typeof INVALID {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return INVALID;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmOrProjectsRead(user);

    const { searchParams } = new URL(req.url);
    const projectIdParam = searchParams.get("project_id");
    const userIdParam = searchParams.get("user_id");

    const q = sql();

    if (projectIdParam) {
      const projectId = Number(projectIdParam);
      if (!Number.isFinite(projectId) || projectId <= 0) {
        return NextResponse.json({ assignments: [] });
      }
      const projectRows = (await q`
        select owner_id from projects
        where id = ${projectId} and deleted_at is null
        limit 1
      `) as Array<{ owner_id: number | null }>;
      if (projectRows.length === 0) {
        return NextResponse.json({ error: "project not found" }, { status: 404 });
      }
      if (
        !(await canViewProjectRoster(
          user.id,
          user.role,
          projectId,
          projectRows[0].owner_id,
        ))
      ) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      const rows = (await q`
        select pa.id, pa.project_id, pa.user_id, u.username,
               pa.role, pa.assigned_by, au.username as assigned_by_username,
               pa.location, pa.start_date, pa.end_date, pa.notes,
               pa.scope_of_work, pa.status, pa.company_name, pa.client_name,
               pa.contact_name, pa.contact_email, pa.contact_phone, pa.created_at
        from project_assignments pa
        join users u on u.id = pa.user_id
        left join users au on au.id = pa.assigned_by
        where pa.project_id = ${projectId} and pa.deleted_at is null
        order by pa.role, u.username
      `) as AssignmentRow[];
      return NextResponse.json({ assignments: rows });
    }

    if (userIdParam) {
      const targetUserId = Number(userIdParam);
      if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
        return NextResponse.json({ assignments: [] });
      }
      if (user.role !== "admin" && targetUserId !== user.id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      const rows = (await q`
        select pa.id, pa.project_id, pa.user_id, u.username,
               pa.role, pa.assigned_by, au.username as assigned_by_username,
               pa.location, pa.start_date, pa.end_date, pa.notes, pa.created_at,
               p.name as project_name, p.folder_id
        from project_assignments pa
        join users u on u.id = pa.user_id
        left join users au on au.id = pa.assigned_by
        join projects p on p.id = pa.project_id
        where pa.user_id = ${targetUserId}
          and pa.deleted_at is null
          and p.deleted_at is null
        order by p.name
      `) as (AssignmentRow & { project_name: string; folder_id: number })[];
      return NextResponse.json({ assignments: rows });
    }

    return NextResponse.json(
      { error: "project_id or user_id required" },
      { status: 400 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmClientWrite(user);

    const body = (await req.json()) as {
      project_id?: number;
      user_id?: number;
      role?: string;
      location?: string | null;
      start_date?: string | null;
      end_date?: string | null;
      notes?: string | null;
      // Distribution work-order fields.
      scope_of_work?: string | null;
      status?: string | null;
      company_name?: string | null;
      client_name?: string | null;
      contact_name?: string | null;
      contact_email?: string | null;
      contact_phone?: string | null;
    };

    const projectId = Number(body.project_id);
    const userId = Number(body.user_id);
    const role = String(body.role || "");

    if (!Number.isInteger(projectId) || projectId <= 0) {
      return NextResponse.json({ error: "invalid project_id" }, { status: 400 });
    }
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "invalid user_id" }, { status: 400 });
    }
    if (!["technical", "engineer", "manager"].includes(role)) {
      return NextResponse.json(
        { error: "role must be technical, engineer, or manager" },
        { status: 400 },
      );
    }

    const q = sql();
    const projectRows = (await q`
      select id, owner_id from projects
      where id = ${projectId} and deleted_at is null
      limit 1
    `) as Array<{ id: number; owner_id: number | null }>;
    if (projectRows.length === 0) {
      return NextResponse.json({ error: "project not found" }, { status: 404 });
    }
    if (
      !(await canManageAssignments(user.id, user.role, projectRows[0].owner_id))
    ) {
      return NextResponse.json(
        { error: "requires admin, project owner, or projects.manager" },
        { status: 403 },
      );
    }

    const userExists = (await q`
      select id from users where id = ${userId}
    `) as Array<{ id: number }>;
    if (userExists.length === 0) {
      return NextResponse.json({ error: "user not found" }, { status: 404 });
    }

    // Soft-revoke previously archived rows on the same triple first
    // (clean re-attach) and only THEN insert. We do this in two steps
    // instead of an UPSERT because there's no composite uniqueness on
    // (project_id, user_id, role) — the BIGSERIAL id is the PK — so a
    // plain insert would silently create duplicates over time. The
    // un-archive plus insert pattern keeps every previous assignment
    // row in the audit history while leaving exactly one active row
    // per triple.
    await q`
      update project_assignments
      set deleted_at = null
      where project_id = ${projectId}
        and user_id = ${userId}
        and role = ${role}
        and deleted_at is not null
    `;

    const existing = (await q`
      select id from project_assignments
      where project_id = ${projectId}
        and user_id = ${userId}
        and role = ${role}
        and deleted_at is null
      limit 1
    `) as Array<{ id: number }>;

    let assignmentId: number;
    if (existing.length > 0) {
      assignmentId = existing[0].id;
      await q`
        update project_assignments
        set location = ${body.location ?? null},
            start_date = ${body.start_date ?? null},
            end_date = ${body.end_date ?? null},
            notes = ${body.notes ?? null},
            scope_of_work = ${body.scope_of_work ?? null},
            status = ${body.status ?? "assigned"},
            company_name = ${body.company_name ?? null},
            client_name = ${body.client_name ?? null},
            contact_name = ${body.contact_name ?? null},
            contact_email = ${body.contact_email ?? null},
            contact_phone = ${body.contact_phone ?? null}
        where id = ${assignmentId}
      `;
    } else {
      const inserted = (await q`
        insert into project_assignments
          (project_id, user_id, role, assigned_by, location, start_date, end_date, notes,
           scope_of_work, status, company_name, client_name, contact_name, contact_email,
           contact_phone)
        values
          (${projectId}, ${userId}, ${role}, ${user.id},
           ${body.location ?? null}, ${body.start_date ?? null},
           ${body.end_date ?? null}, ${body.notes ?? null},
           ${body.scope_of_work ?? null}, ${body.status ?? "assigned"},
           ${body.company_name ?? null}, ${body.client_name ?? null},
           ${body.contact_name ?? null}, ${body.contact_email ?? null},
           ${body.contact_phone ?? null})
        returning id
      `) as Array<{ id: number }>;
      assignmentId = inserted[0].id;
    }

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'project_assignment', ${assignmentId}, 'assign',
              ${JSON.stringify({
                project_id: projectId,
                user_id: userId,
                role,
              })}::jsonb)
    `;

    // Notify the assignee on whatever device they've installed the app on.
    const projNameRows = (await q`
      select name from projects where id = ${projectId} limit 1
    `) as Array<{ name: string }>;
    const projName = projNameRows[0]?.name || "a project";
    const due = body.end_date ? ` · due ${body.end_date}` : "";
    void sendPushToUsers([userId], {
      title: `Assigned to ${projName}`,
      body: `Role: ${role}${due}${body.notes ? ` · ${String(body.notes).slice(0, 100)}` : ""}`,
      url: `/projects/${projectId}`,
      tag: `assignment-${projectId}-${userId}`,
    });

    return NextResponse.json({ ok: true, id: assignmentId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmClientWrite(user);

    const body = (await req.json()) as {
      id?: number;
      start_date?: string | null;
      end_date?: string | null;
      user_id?: number;
      // Distribution work-order edits.
      scope_of_work?: string | null;
      status?: string | null;
      location?: string | null;
      notes?: string | null;
      company_name?: string | null;
      client_name?: string | null;
      contact_name?: string | null;
      contact_email?: string | null;
      contact_phone?: string | null;
    };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    const q = sql();
    const rows = (await q`
      select pa.id, pa.project_id, p.owner_id
      from project_assignments pa
      join projects p on p.id = pa.project_id
      where pa.id = ${id} and pa.deleted_at is null
      limit 1
    `) as Array<{ id: number; project_id: number; owner_id: number | null }>;

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "active assignment not found" },
        { status: 404 },
      );
    }
    if (!(await canManageAssignments(user.id, user.role, rows[0].owner_id))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // Distribution work-order edit: the PM tweaks scope / status / notes /
    // context on an existing distribution. The edit form posts the full field
    // set, so we set them all when any distribution field is present. Runs
    // independently of the date reschedule below (they can arrive together).
    const isDistributionUpdate =
      body.scope_of_work !== undefined ||
      body.status !== undefined ||
      body.location !== undefined ||
      body.notes !== undefined ||
      body.company_name !== undefined ||
      body.client_name !== undefined ||
      body.contact_name !== undefined ||
      body.contact_email !== undefined ||
      body.contact_phone !== undefined;
    if (isDistributionUpdate) {
      await q`
        update project_assignments
        set scope_of_work = ${body.scope_of_work ?? null},
            status = ${body.status ?? "assigned"},
            location = ${body.location ?? null},
            notes = ${body.notes ?? null},
            company_name = ${body.company_name ?? null},
            client_name = ${body.client_name ?? null},
            contact_name = ${body.contact_name ?? null},
            contact_email = ${body.contact_email ?? null},
            contact_phone = ${body.contact_phone ?? null}
        where id = ${id}
      `;
    }

    // Reschedule / reassign (the day scheduler) vs. soft-revoke (unassign).
    // A scheduling PATCH always carries start_date + end_date (string or
    // null) and optionally user_id; a bare { id } means unassign, preserving
    // the original revoke behaviour for existing callers.
    const isReschedule =
      body.start_date !== undefined ||
      body.end_date !== undefined ||
      body.user_id !== undefined;

    if (isReschedule) {
      const start = normSchedDate(body.start_date);
      const end = normSchedDate(body.end_date);
      if (start === INVALID || end === INVALID) {
        return NextResponse.json(
          { error: "start_date and end_date must be YYYY-MM-DD or null" },
          { status: 400 },
        );
      }
      let newUserId: number | null = null;
      if (body.user_id !== undefined) {
        newUserId = Number(body.user_id);
        if (!Number.isInteger(newUserId) || newUserId <= 0) {
          return NextResponse.json({ error: "invalid user_id" }, { status: 400 });
        }
        const ux = (await q`select id from users where id = ${newUserId}`) as Array<{
          id: number;
        }>;
        if (ux.length === 0) {
          return NextResponse.json({ error: "user not found" }, { status: 404 });
        }
      }

      if (newUserId !== null) {
        await q`
          update project_assignments
          set start_date = ${start}, end_date = ${end}, user_id = ${newUserId}
          where id = ${id}
        `;
      } else {
        await q`
          update project_assignments
          set start_date = ${start}, end_date = ${end}
          where id = ${id}
        `;
      }

      await q`
        insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
        values (${user.id}, 'project_assignment', ${id}, 'reschedule',
                ${JSON.stringify({
                  start_date: start,
                  end_date: end,
                  user_id: newUserId,
                })}::jsonb)
      `;

      return NextResponse.json({ ok: true });
    }

    // A distribution-only edit (no reschedule fields) is already applied above
    // — return success instead of falling through to the bare-{id} unassign.
    if (isDistributionUpdate) {
      return NextResponse.json({ ok: true, id });
    }

    await q`
      update project_assignments
      set deleted_at = now()
      where id = ${id}
    `;

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'project_assignment', ${id}, 'unassign', '{}'::jsonb)
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
