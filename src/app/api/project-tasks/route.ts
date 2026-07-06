import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { hasModule } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-project to-do checklist. The assigned technician/engineer ticks items
 * off during execution; the PM and project owner read the progress.
 *
 *   GET    ?project_id=X         → the checklist (anyone who can see project)
 *   POST   { project_id, title } → add an item (assigned member / owner / admin)
 *   PATCH  { id, done?, title? } → toggle done or rename (same editors)
 *   DELETE ?id=X                 → soft-delete an item (same editors)
 */

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

/** View: admin / owner / any projects-module user / an assigned member. */
async function canRead(
  q: ReturnType<typeof sql>,
  project: ProjectRow,
  user: { id: number; role: string },
): Promise<boolean> {
  return (
    canReadAll(user) ||
    project.owner_id === user.id ||
    (await hasModule(user.id, "projects")) ||
    (await isAssigned(q, project.id, user.id))
  );
}

/** Edit/tick: admin / owner / an assigned member (the people doing the work). */
async function canEdit(
  q: ReturnType<typeof sql>,
  project: ProjectRow,
  user: { id: number; role: string },
): Promise<boolean> {
  return (
    canReadAll(user) ||
    project.owner_id === user.id ||
    (await isAssigned(q, project.id, user.id))
  );
}

/** Resolve the project behind a task id, for PATCH/DELETE auth. */
async function loadProjectForTask(
  q: ReturnType<typeof sql>,
  taskId: number,
): Promise<ProjectRow | null> {
  const rows = (await q`
    select p.id, p.owner_id
    from project_tasks t
    join projects p on p.id = t.project_id and p.deleted_at is null
    where t.id = ${taskId} and t.deleted_at is null
    limit 1
  `) as ProjectRow[];
  return rows[0] ?? null;
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
    if (!project) return NextResponse.json({ tasks: [], can_edit: false });
    if (!(await canRead(q, project, user))) {
      return NextResponse.json({ tasks: [], can_edit: false });
    }
    const tasks = (await q`
      select t.id, t.title, t.done, t.position, t.done_at,
             t.created_at, u.display_name as done_by_name, u.username as done_by_username
      from project_tasks t
      left join users u on u.id = t.done_by
      where t.project_id = ${projectId} and t.deleted_at is null
      order by t.done, t.position, t.id
    `) as Array<Record<string, unknown>>;
    return NextResponse.json({
      tasks,
      can_edit: await canEdit(q, project, user),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const body = (await req.json()) as { project_id?: number; title?: string };
    const projectId = Number(body.project_id);
    const title = String(body.title || "").trim();
    if (!Number.isFinite(projectId) || projectId <= 0 || !title) {
      return NextResponse.json(
        { error: "project_id and a non-empty title are required" },
        { status: 400 },
      );
    }
    const q = sql();
    const project = await loadProject(q, projectId);
    if (!project) {
      return NextResponse.json({ error: "project not found" }, { status: 404 });
    }
    if (!(await canEdit(q, project, user))) {
      return NextResponse.json(
        { error: "only assigned members can edit the checklist" },
        { status: 403 },
      );
    }
    const inserted = (await q`
      insert into project_tasks (project_id, title, created_by, position)
      values (
        ${projectId}, ${title.slice(0, 500)}, ${user.id},
        coalesce(
          (select max(position) + 1 from project_tasks
             where project_id = ${projectId} and deleted_at is null),
          0
        )
      )
      returning id, title, done, position, done_at, created_at
    `) as Array<Record<string, unknown>>;
    return NextResponse.json({ task: inserted[0] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const body = (await req.json()) as {
      id?: number;
      done?: boolean;
      title?: string;
    };
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const q = sql();
    const project = await loadProjectForTask(q, id);
    if (!project) {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }
    if (!(await canEdit(q, project, user))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    if (typeof body.done === "boolean") {
      if (body.done) {
        await q`
          update project_tasks
          set done = true, done_by = ${user.id}, done_at = now()
          where id = ${id}
        `;
      } else {
        await q`
          update project_tasks
          set done = false, done_by = null, done_at = null
          where id = ${id}
        `;
      }
    }
    if (typeof body.title === "string") {
      const title = body.title.trim();
      if (title) {
        await q`update project_tasks set title = ${title.slice(0, 500)} where id = ${id}`;
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const q = sql();
    const project = await loadProjectForTask(q, id);
    if (!project) {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }
    if (!(await canEdit(q, project, user))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    // Permanent delete (no Trash). Not recoverable.
    await q`delete from project_tasks where id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
