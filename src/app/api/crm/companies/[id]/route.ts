import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";
import { logActivity } from "@/lib/crm/activity";

export const runtime = "nodejs";

interface CompanyRow {
  id: number;
  owner_id: number | null;
  folder_id: number | null;
  name: string;
  website: string | null;
  industry: string | null;
  size_bucket: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

async function loadOrThrow(id: number, userId: number, isAdmin: boolean): Promise<CompanyRow> {
  const q = sql();
  const rows = (await q`
    select id, owner_id, folder_id, name, website, industry, size_bucket,
           notes, created_at, updated_at
    from companies
    where id = ${id} and deleted_at is null
  `) as CompanyRow[];
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
    const company = await loadOrThrow(Number(id), user.id, user.role === "admin");
    return NextResponse.json({ company });
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
    const body = (await req.json()) as Partial<CompanyRow>;
    const q = sql();
    const rows = (await q`
      update companies set
        folder_id   = ${body.folder_id   !== undefined ? body.folder_id   : existing.folder_id},
        name        = ${body.name        !== undefined ? body.name        : existing.name},
        website     = ${body.website     !== undefined ? body.website     : existing.website},
        industry    = ${body.industry    !== undefined ? body.industry    : existing.industry},
        size_bucket = ${body.size_bucket !== undefined ? body.size_bucket : existing.size_bucket},
        notes       = ${body.notes       !== undefined ? body.notes       : existing.notes},
        updated_at  = now()
      where id = ${existing.id}
      returning id, owner_id, folder_id, name, website, industry, size_bucket,
                notes, created_at, updated_at
    `) as CompanyRow[];
    await logActivity({
      ownerId: rows[0].owner_id,
      actorId: user.id,
      entityType: "company",
      entityId: rows[0].id,
      verb: "updated",
    });
    return NextResponse.json({ company: rows[0] });
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
    await q`update companies set deleted_at = now() where id = ${existing.id}`;
    await logActivity({
      ownerId: existing.owner_id,
      actorId: user.id,
      entityType: "company",
      entityId: existing.id,
      verb: "deleted",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
