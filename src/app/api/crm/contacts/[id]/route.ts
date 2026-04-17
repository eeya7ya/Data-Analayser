import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";
import { logActivity } from "@/lib/crm/activity";

export const runtime = "nodejs";

interface ContactRow {
  id: number;
  owner_id: number | null;
  folder_id: number | null;
  company_id: number | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

async function loadOrThrow(id: number, userId: number, isAdmin: boolean): Promise<ContactRow> {
  const q = sql();
  const rows = (await q`
    select id, owner_id, folder_id, company_id, first_name, last_name,
           email, phone, title, notes, created_at, updated_at
    from contacts
    where id = ${id} and deleted_at is null
  `) as ContactRow[];
  const row = rows[0];
  if (!row) throw new Error("NOT_FOUND");
  if (!isAdmin && row.owner_id !== userId) throw new Error("FORBIDDEN");
  return row;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const { id } = await params;
    const contact = await loadOrThrow(Number(id), user.id, user.role === "admin");
    return NextResponse.json({ contact });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
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
    const body = (await req.json()) as Partial<ContactRow>;
    const q = sql();
    const rows = (await q`
      update contacts set
        folder_id  = ${body.folder_id  !== undefined ? body.folder_id  : existing.folder_id},
        company_id = ${body.company_id !== undefined ? body.company_id : existing.company_id},
        first_name = ${body.first_name !== undefined ? body.first_name : existing.first_name},
        last_name  = ${body.last_name  !== undefined ? body.last_name  : existing.last_name},
        email      = ${body.email      !== undefined ? body.email      : existing.email},
        phone      = ${body.phone      !== undefined ? body.phone      : existing.phone},
        title      = ${body.title      !== undefined ? body.title      : existing.title},
        notes      = ${body.notes      !== undefined ? body.notes      : existing.notes},
        updated_at = now()
      where id = ${existing.id}
      returning id, owner_id, folder_id, company_id, first_name, last_name,
                email, phone, title, notes, created_at, updated_at
    `) as ContactRow[];
    await logActivity({
      ownerId: rows[0].owner_id,
      actorId: user.id,
      entityType: "contact",
      entityId: rows[0].id,
      verb: "updated",
    });
    return NextResponse.json({ contact: rows[0] });
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
    await q`update contacts set deleted_at = now() where id = ${existing.id}`;
    await logActivity({
      ownerId: existing.owner_id,
      actorId: user.id,
      entityType: "contact",
      entityId: existing.id,
      verb: "deleted",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
