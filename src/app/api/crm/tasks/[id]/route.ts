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

async function loadOrThrow(id: number, userId: number, isAdmin: boolean): Promise<TaskRow> {
  const q = sql();
  const rows = (await q`
    select id, owner_id, assignee_id, entity_type, entity_id, title,
           description, due_at, priority, status, created_at, updated_at
    from tasks where id = ${id} and deleted_at is null
  `) as TaskRow[];
  if (!rows[0]) throw new Error("NOT_FOUND");
  if (!isAdmin && rows[0].owner_id !== userId && rows[0].assignee_id !== userId) {
    throw new Error("FORBIDDEN");
  }
  return rows[0];
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const { id } = await params;
    const existing = await loadOrThrow(Number(id), user.id, user.role === "admin");
    const body = (await req.json()) as Partial<TaskRow>;
    const q = sql();
    const rows = (await q`
      update tasks set
        assignee_id = ${body.assignee_id !== undefined ? body.assignee_id : existing.assignee_id},
        title       = ${body.title       !== undefined ? body.title       : existing.title},
        description = ${body.description !== undefined ? body.description : existing.description},
        due_at      = ${body.due_at      !== undefined ? body.due_at      : existing.due_at},
        priority    = ${body.priority    !== undefined ? body.priority    : existing.priority},
        status      = ${body.status      !== undefined ? body.status      : existing.status},
        updated_at  = now()
      where id = ${existing.id}
      returning id, owner_id, assignee_id, entity_type, entity_id, title,
                description, due_at, priority, status, created_at, updated_at
    `) as TaskRow[];
    const verb =
      body.status && body.status !== existing.status
        ? body.status === "done"
          ? "completed"
          : "status_changed"
        : "updated";
    await logActivity({
      ownerId: rows[0].owner_id,
      actorId: user.id,
      entityType: "task",
      entityId: rows[0].id,
      verb,
    });
    return NextResponse.json({ task: rows[0] });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const { id } = await params;
    const existing = await loadOrThrow(Number(id), user.id, user.role === "admin");
    const q = sql();
    await q`update tasks set deleted_at = now() where id = ${existing.id}`;
    await logActivity({
      ownerId: existing.owner_id,
      actorId: user.id,
      entityType: "task",
      entityId: existing.id,
      verb: "deleted",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
