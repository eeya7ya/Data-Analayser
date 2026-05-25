import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { hasModule } from "@/lib/modules";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Execution reports — a project technician / engineer posts progress
 * updates and feedback on a project they're assigned to; the project
 * manager and project owner read them.
 *
 *   GET  ?project_id=X → reports for a project (anyone who can see the
 *                        project: admin / owner / projects-module user /
 *                        assigned member).
 *   POST               → add a report. Allowed for an assigned member, the
 *                        project owner, or admin.
 */

const KINDS = ["update", "blocker", "done"] as const;

interface ProjectRow {
  id: number;
  owner_id: number | null;
}

async function loadProject(
  q: ReturnType<typeof sql>,
  projectId: number,
): Promise<ProjectRow | null> {
  const rows = (await q`
    select id, owner_id from projects
    where id = ${projectId} and deleted_at is null
    limit 1
  `) as ProjectRow[];
  return rows[0] ?? null;
}

async function isAssigned(
  q: ReturnType<typeof sql>,
  projectId: number,
  userId: number,
): Promise<boolean> {
  const rows = (await q`
    select 1 from project_assignments
    where project_id = ${projectId} and user_id = ${userId} and deleted_at is null
    limit 1
  `) as Array<{ "?column?": number }>;
  return rows.length > 0;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const projectId = Number(new URL(req.url).searchParams.get("project_id"));
    if (!Number.isFinite(projectId) || projectId <= 0) {
      return NextResponse.json({ error: "project_id required" }, { status: 400 });
    }
    const q = sql();
    const project = await loadProject(q, projectId);
    if (!project) return NextResponse.json({ reports: [] });

    const canRead =
      canReadAll(user) ||
      project.owner_id === user.id ||
      (await hasModule(user.id, "projects")) ||
      (await isAssigned(q, projectId, user.id));
    if (!canRead) {
      return NextResponse.json({ reports: [], can_post: false });
    }

    const reports = (await q`
      select r.id, r.project_id, r.kind, r.progress, r.body, r.created_at,
             u.username as author_username, u.display_name as author_name
      from execution_reports r
      left join users u on u.id = r.author_id
      where r.project_id = ${projectId}
      order by r.created_at desc
      limit 200
    `) as Array<Record<string, unknown>>;

    const canPost =
      canReadAll(user) ||
      project.owner_id === user.id ||
      (await isAssigned(q, projectId, user.id));

    return NextResponse.json({ reports, can_post: canPost });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const body = (await req.json()) as {
      project_id?: number;
      kind?: string;
      progress?: number | null;
      body?: string;
    };
    const projectId = Number(body.project_id);
    const text = String(body.body || "").trim();
    if (!Number.isFinite(projectId) || projectId <= 0 || !text) {
      return NextResponse.json(
        { error: "project_id and a report body are required" },
        { status: 400 },
      );
    }
    const kind = (KINDS as readonly string[]).includes(String(body.kind))
      ? (body.kind as string)
      : "update";
    let progress: number | null = null;
    if (body.progress !== null && body.progress !== undefined) {
      const p = Math.trunc(Number(body.progress));
      if (Number.isFinite(p)) progress = Math.min(100, Math.max(0, p));
    }

    const q = sql();
    const project = await loadProject(q, projectId);
    if (!project) {
      return NextResponse.json({ error: "project not found" }, { status: 404 });
    }
    const canPost =
      canReadAll(user) ||
      project.owner_id === user.id ||
      (await isAssigned(q, projectId, user.id));
    if (!canPost) {
      return NextResponse.json(
        { error: "only assigned project members can post a report" },
        { status: 403 },
      );
    }

    const inserted = (await q`
      insert into execution_reports (project_id, author_id, kind, progress, body)
      values (${projectId}, ${user.id}, ${kind}, ${progress}, ${text.slice(0, 4000)})
      returning id, project_id, kind, progress, body, created_at
    `) as Array<Record<string, unknown>>;

    // Notify the project owner + every projects manager assigned to this
    // project (or any projects manager if none) so the PM sees feedback.
    const recipients = new Set<number>();
    if (project.owner_id && project.owner_id !== user.id) {
      recipients.add(project.owner_id);
    }
    const managers = (await q`
      select distinct pa.user_id from project_assignments pa
      where pa.project_id = ${projectId} and pa.role = 'manager'
        and pa.deleted_at is null
    `) as Array<{ user_id: number }>;
    for (const m of managers) if (m.user_id !== user.id) recipients.add(m.user_id);

    if (recipients.size > 0) {
      void sendPushToUsers([...recipients], {
        title: `Execution report${kind === "blocker" ? " — blocker" : ""}`,
        body: text.slice(0, 140),
        url: `/projects/${projectId}`,
        tag: `exec-report-${projectId}`,
      });
    }

    return NextResponse.json({ report: inserted[0] });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
