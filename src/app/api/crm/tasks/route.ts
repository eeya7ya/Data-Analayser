import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";
import { logActivity } from "@/lib/crm/activity";

export const runtime = "nodejs";

interface TaskRow {
  id: number;
  owner_id: number | null;
  assignee_id: number | null;
  entity_type: string | null;
  entity_id: number | null;
  title: string;
  description: string | null;
  due_at: string | null;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const url = new URL(req.url);
    const entityType = url.searchParams.get("entity_type");
    const entityIdRaw = url.searchParams.get("entity_id");
    const status = url.searchParams.get("status") ?? "open";
    const q = sql();
    let rows: TaskRow[];
    if (entityType && entityIdRaw) {
      rows = (user.role === "admin"
        ? await q`
            select id, owner_id, assignee_id, entity_type, entity_id, title,
                   description, due_at, priority, status, created_at, updated_at
            from tasks
            where entity_type = ${entityType} and entity_id = ${Number(entityIdRaw)}
              and deleted_at is null
            order by status asc, due_at nulls last, id desc
            limit 500
          `
        : await q`
            select id, owner_id, assignee_id, entity_type, entity_id, title,
                   description, due_at, priority, status, created_at, updated_at
            from tasks
            where entity_type = ${entityType} and entity_id = ${Number(entityIdRaw)}
              and (owner_id = ${user.id} or assignee_id = ${user.id})
              and deleted_at is null
            order by status asc, due_at nulls last, id desc
            limit 500
          `) as TaskRow[];
    } else {
      rows = (user.role === "admin"
        ? await q`
            select id, owner_id, assignee_id, entity_type, entity_id, title,
                   description, due_at, priority, status, created_at, updated_at
            from tasks
            where status = ${status} and deleted_at is null
            order by due_at nulls last, id desc
            limit 500
          `
        : await q`
            select id, owner_id, assignee_id, entity_type, entity_id, title,
                   description, due_at, priority, status, created_at, updated_at
            from tasks
            where status = ${status} and deleted_at is null
              and (owner_id = ${user.id} or assignee_id = ${user.id})
            order by due_at nulls last, id desc
            limit 500
          `) as TaskRow[];
    }
    return NextResponse.json({ tasks: rows });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const body = (await req.json()) as Partial<TaskRow>;
    const title = (body.title ?? "").trim();
    if (!title) throw new Error("BAD_REQUEST");
    const q = sql();
    const created = (await q`
      insert into tasks (owner_id, assignee_id, entity_type, entity_id, title,
                         description, due_at, priority, status)
      values (
        ${user.id},
        ${body.assignee_id ?? user.id},
        ${body.entity_type ?? null},
        ${body.entity_id ?? null},
        ${title},
        ${body.description ?? null},
        ${body.due_at ?? null},
        ${body.priority ?? "normal"},
        ${body.status ?? "open"}
      )
      returning id, owner_id, assignee_id, entity_type, entity_id, title,
                description, due_at, priority, status, created_at, updated_at
    `) as TaskRow[];
    const t = created[0];
    await logActivity({
      ownerId: t.owner_id,
      actorId: user.id,
      entityType: "task",
      entityId: t.id,
      verb: "created",
      meta: { title: t.title, due_at: t.due_at },
    });
    if (t.assignee_id && t.assignee_id !== user.id) {
      await q`
        insert into notifications (user_id, kind, title, body, link)
        values (${t.assignee_id}, ${"task_assigned"}, ${"Task assigned: " + t.title}, ${t.description ?? null}, ${`/crm/tasks`})
      `;
    }
    return NextResponse.json({ task: t }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
