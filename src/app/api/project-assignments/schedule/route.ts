import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { hasModuleRole } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/project-assignments/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * The data behind the project manager's day scheduler. Global (cross-project)
 * so the PM can see every technician's workload and spot double-bookings.
 *
 * Returns:
 *   - technicians[]  every projects-module user (the rows of the board),
 *   - scheduled[]    active assignments with a date overlapping [from,to],
 *   - unscheduled[]  active assignments that have no date yet (the tray the
 *                    PM drags onto a day).
 *
 * Manager/admin only — this is a coordination surface, not a personal view.
 */

interface ScheduleAssignment {
  id: number;
  project_id: number;
  project_name: string;
  client_name: string | null;
  status: string;
  user_id: number;
  role: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();

    const isManager =
      canReadAll(user) || (await hasModuleRole(user.id, "projects", "manager"));
    if (!isManager) {
      return NextResponse.json(
        { error: "requires admin or projects.manager" },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(req.url);
    const from = parseDate(searchParams.get("from"));
    const to = parseDate(searchParams.get("to"));
    if (!from || !to) {
      return NextResponse.json(
        { error: "from and to (YYYY-MM-DD) are required" },
        { status: 400 },
      );
    }

    const q = sql();

    // Board rows: every user holding any projects-module grant, with their
    // role(s) aggregated for a label.
    // group_concat is the SQLite/D1 equivalent of array_agg; it returns a
    // comma-separated string (no in-aggregate ORDER BY), so we split + sort the
    // roles in JS to preserve the original `string[]` shape.
    const technicianRows = (await q`
      select u.id, u.username, u.display_name,
             group_concat(distinct umr.role) as roles
      from users u
      join user_module_roles umr
        on umr.user_id = u.id
       and umr.module = 'projects'
       and umr.revoked_at is null
      group by u.id, u.username, u.display_name
      order by coalesce(u.display_name, u.username)
    `) as Array<{
      id: number;
      username: string;
      display_name: string | null;
      roles: string | string[] | null;
    }>;
    const technicians = technicianRows.map((t) => ({
      ...t,
      roles: Array.isArray(t.roles)
        ? t.roles
        : t.roles
          ? String(t.roles).split(",").sort()
          : [],
    }));

    // Assignments with a date that overlaps the requested window.
    const scheduled = (await q`
      select pa.id, pa.project_id, p.name as project_name,
             cf.name as client_name, p.status,
             pa.user_id, pa.role, pa.location,
             substr(cast(pa.start_date as text), 1, 10) as start_date,
             substr(cast(pa.end_date as text), 1, 10) as end_date,
             pa.notes
      from project_assignments pa
      join projects p on p.id = pa.project_id and p.deleted_at is null
      left join client_folders cf on cf.id = p.folder_id
      where pa.deleted_at is null
        and pa.start_date is not null
        and pa.start_date <= ${to}::date
        and coalesce(pa.end_date, pa.start_date) >= ${from}::date
      order by pa.start_date, p.name
    `) as ScheduleAssignment[];

    // Assigned but not yet placed on a day — the drag tray.
    const unscheduled = (await q`
      select pa.id, pa.project_id, p.name as project_name,
             cf.name as client_name, p.status,
             pa.user_id, pa.role, pa.location,
             pa.start_date, pa.end_date, pa.notes
      from project_assignments pa
      join projects p on p.id = pa.project_id and p.deleted_at is null
      left join client_folders cf on cf.id = p.folder_id
      where pa.deleted_at is null
        and pa.start_date is null
      order by p.updated_at desc
      limit 200
    `) as ScheduleAssignment[];

    return NextResponse.json({ technicians, scheduled, unscheduled });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/** Accept a strict YYYY-MM-DD and echo it back, else null. */
function parseDate(raw: string | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : raw;
}
