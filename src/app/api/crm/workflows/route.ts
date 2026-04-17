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
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const q = sql();
    const rows = (user.role === "admin"
      ? await q`
          select id, owner_id, name, trigger_kind, trigger_json, actions_json,
                 enabled, last_run_at, created_at, updated_at
          from workflows where deleted_at is null order by id desc
          limit 500
        `
      : await q`
          select id, owner_id, name, trigger_kind, trigger_json, actions_json,
                 enabled, last_run_at, created_at, updated_at
          from workflows where owner_id = ${user.id} and deleted_at is null
          order by id desc
          limit 500
        `) as WorkflowRow[];
    return NextResponse.json({ workflows: rows });
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
    const body = (await req.json()) as Partial<WorkflowRow>;
    const name = (body.name ?? "").trim();
    if (!name || !body.trigger_kind) throw new Error("BAD_REQUEST");
    const q = sql();
    const trigger = JSON.stringify(body.trigger_json ?? {});
    const actions = JSON.stringify(body.actions_json ?? []);
    const created = (await q`
      insert into workflows (owner_id, name, trigger_kind, trigger_json, actions_json, enabled)
      values (
        ${user.id},
        ${name},
        ${body.trigger_kind},
        ${trigger}::jsonb,
        ${actions}::jsonb,
        ${body.enabled ?? true}
      )
      returning id, owner_id, name, trigger_kind, trigger_json, actions_json,
                enabled, last_run_at, created_at, updated_at
    `) as WorkflowRow[];
    return NextResponse.json({ workflow: created[0] }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
