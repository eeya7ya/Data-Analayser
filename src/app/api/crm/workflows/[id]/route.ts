import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";

export const runtime = "nodejs";

interface WorkflowRow {
  id: number;
  owner_id: number | null;
  name: string;
  trigger_kind: string;
  trigger_json: Record<string, unknown>;
  actions_json: unknown[];
  enabled: boolean;
}

async function loadOrThrow(id: number, userId: number, isAdmin: boolean): Promise<WorkflowRow> {
  const q = sql();
  const rows = (await q`
    select id, owner_id, name, trigger_kind, trigger_json, actions_json, enabled
    from workflows where id = ${id} and deleted_at is null
  `) as WorkflowRow[];
  if (!rows[0]) throw new Error("NOT_FOUND");
  if (!isAdmin && rows[0].owner_id !== userId) throw new Error("FORBIDDEN");
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
    const body = (await req.json()) as Partial<WorkflowRow>;
    const q = sql();
    const trigger = JSON.stringify(
      body.trigger_json !== undefined ? body.trigger_json : existing.trigger_json,
    );
    const actions = JSON.stringify(
      body.actions_json !== undefined ? body.actions_json : existing.actions_json,
    );
    const rows = (await q`
      update workflows set
        name         = ${body.name         !== undefined ? body.name         : existing.name},
        trigger_kind = ${body.trigger_kind !== undefined ? body.trigger_kind : existing.trigger_kind},
        trigger_json = ${trigger}::jsonb,
        actions_json = ${actions}::jsonb,
        enabled      = ${body.enabled      !== undefined ? body.enabled      : existing.enabled},
        updated_at   = now()
      where id = ${existing.id}
      returning id, owner_id, name, trigger_kind, trigger_json, actions_json,
                enabled, last_run_at, created_at, updated_at
    `) as WorkflowRow[];
    return NextResponse.json({ workflow: rows[0] });
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
    await q`update workflows set deleted_at = now() where id = ${existing.id}`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
