import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/execution-reports/summary?period=today|week|month
 *
 * The project-manager roll-up behind the execution dashboard. Scoped to the
 * caller's project portfolio:
 *   - admins see every non-deleted project,
 *   - everyone else sees projects they own or are assigned to (a PM is
 *     assigned as `manager`, so this is their portfolio).
 *
 * Returns, for that scope:
 *   - projects[]  with a derived completion % (latest reported progress, or
 *                 100 once a `done` report lands) + open-blocker count,
 *   - reports[]   every execution report in the chosen period across those
 *                 projects (period=today is the "all of today's execution in
 *                 one place" view), newest first,
 *   - summary     period totals (reports / blockers / done) + average
 *                 completion across the portfolio.
 *
 * Read-only; never mutates.
 */

const TRUNC: Record<string, "day" | "week" | "month"> = {
  today: "day",
  week: "week",
  month: "month",
};

type ProjectRow = {
  id: number;
  name: string;
  status: string;
  client_name: string | null;
  completion: number;
  blocker_count: number;
  last_report_at: string | null;
};

type ReportRow = {
  id: number;
  project_id: number;
  project_name: string;
  kind: string;
  progress: number | null;
  body: string;
  created_at: string;
  author_name: string | null;
  author_username: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const periodParam = new URL(req.url).searchParams.get("period") || "today";
    const period = periodParam in TRUNC ? periodParam : "today";
    const truncUnit = TRUNC[period];
    const isAdmin = canReadAll(user);
    const q = sql();

    // Start of the chosen period as a YYYY-MM-DD cutoff, computed in JS so it
    // works on D1/SQLite (no date_trunc). Date-only avoids timestamp-format
    // mismatches at the boundary (CURRENT_TIMESTAMP vs ISO).
    const periodStart = new Date();
    periodStart.setHours(0, 0, 0, 0);
    if (truncUnit === "week") {
      const dow = (periodStart.getDay() + 6) % 7; // 0 = Monday
      periodStart.setDate(periodStart.getDate() - dow);
    } else if (truncUnit === "month") {
      periodStart.setDate(1);
    }
    const periodCutoff = periodStart.toISOString().slice(0, 10);

    // Portfolio + per-project completion. The completion expression forces
    // 100 once any `done` report exists, otherwise takes the most recent
    // non-null progress (0 when nothing's been reported yet).
    const projects = (await q`
      with scoped as (
        select p.id, p.name, p.status, p.updated_at, cf.name as client_name
        from projects p
        join client_folders cf on cf.id = p.folder_id
        where p.deleted_at is null
          and (
            ${isAdmin}::boolean
            or p.owner_id = ${user.id}
            or exists (
              select 1 from project_assignments pa
              where pa.project_id = p.id and pa.user_id = ${user.id}
                and pa.deleted_at is null
            )
          )
      )
      select
        s.id, s.name, s.status, s.client_name,
        case
          when exists (
            select 1 from execution_reports r
            where r.project_id = s.id and r.kind = 'done'
          ) then 100
          when exists (
            select 1 from execution_reports r
            where r.project_id = s.id and r.progress is not null
          ) then (
            select r.progress from execution_reports r
            where r.project_id = s.id and r.progress is not null
            order by r.created_at desc
            limit 1
          )
          when exists (
            select 1 from project_tasks t
            where t.project_id = s.id and t.deleted_at is null
          ) then (
            select round(
              100.0 * count(*) filter (where t.done) / nullif(count(*), 0)
            )::int
            from project_tasks t
            where t.project_id = s.id and t.deleted_at is null
          )
          else 0
        end::int as completion,
        (
          select count(*) from execution_reports r
          where r.project_id = s.id and r.kind = 'blocker'
        )::int as blocker_count,
        (
          select max(r.created_at) from execution_reports r
          where r.project_id = s.id
        ) as last_report_at
      from scoped s
      order by s.updated_at desc
      limit 300
    `) as ProjectRow[];

    const ids = projects.map((p) => p.id);

    let reports: ReportRow[] = [];
    if (ids.length > 0) {
      reports = (await q`
        select
          r.id, r.project_id, p.name as project_name, r.kind, r.progress,
          r.body, r.created_at,
          u.display_name as author_name, u.username as author_username
        from execution_reports r
        join projects p on p.id = r.project_id and p.deleted_at is null
        left join users u on u.id = r.author_id
        where r.project_id = any(${ids})
          and r.created_at >= ${periodCutoff}
        order by r.created_at desc
        limit 400
      `) as ReportRow[];
    }

    const activeForAvg = projects.filter((p) => p.status !== "on_hold");
    const avgCompletion =
      activeForAvg.length > 0
        ? Math.round(
            activeForAvg.reduce((a, p) => a + (p.completion || 0), 0) /
              activeForAvg.length,
          )
        : 0;

    return NextResponse.json({
      period,
      projects,
      reports,
      summary: {
        projectCount: projects.length,
        avgCompletion,
        reportCount: reports.length,
        blockerCount: reports.filter((r) => r.kind === "blocker").length,
        doneCount: reports.filter((r) => r.kind === "done").length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
