import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";

export const runtime = "nodejs";

interface AclRow {
  id: number;
  entity_type: string;
  entity_id: number;
  principal_kind: string;
  principal_id: number;
  perm: string;
  created_at: string;
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const url = new URL(req.url);
    const entityType = url.searchParams.get("entity_type");
    const entityId = url.searchParams.get("entity_id");
    if (!entityType || !entityId) throw new Error("BAD_REQUEST");
    const q = sql();
    const rows = (await q`
      select id, entity_type, entity_id, principal_kind, principal_id, perm, created_at
      from entity_acls
      where entity_type = ${entityType} and entity_id = ${Number(entityId)}
    `) as AclRow[];
    return NextResponse.json({ acls: rows });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const body = (await req.json()) as Partial<AclRow>;
    if (!body.entity_type || !body.entity_id || !body.principal_kind || !body.principal_id) {
      throw new Error("BAD_REQUEST");
    }
    const q = sql();
    await q`
      insert into entity_acls (entity_type, entity_id, principal_kind, principal_id, perm)
      values (${body.entity_type}, ${body.entity_id}, ${body.principal_kind}, ${body.principal_id}, ${body.perm ?? "view"})
      on conflict do nothing
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) throw new Error("BAD_REQUEST");
    const q = sql();
    await q`delete from entity_acls where id = ${Number(id)}`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
