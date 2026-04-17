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

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const q = sql();
    const rows = (user.role === "admin"
      ? await q`
          select id, owner_id, folder_id, name, website, industry, size_bucket,
                 notes, created_at, updated_at
          from companies
          where deleted_at is null
          order by updated_at desc
          limit 500
        `
      : await q`
          select id, owner_id, folder_id, name, website, industry, size_bucket,
                 notes, created_at, updated_at
          from companies
          where owner_id = ${user.id} and deleted_at is null
          order by updated_at desc
          limit 500
        `) as CompanyRow[];
    return NextResponse.json({ companies: rows });
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
    const body = (await req.json()) as Partial<CompanyRow>;
    const name = (body.name ?? "").trim();
    if (!name) throw new Error("BAD_REQUEST");
    const q = sql();
    const rows = (await q`
      insert into companies (owner_id, folder_id, name, website, industry, size_bucket, notes)
      values (
        ${user.id},
        ${body.folder_id ?? null},
        ${name},
        ${body.website ?? null},
        ${body.industry ?? null},
        ${body.size_bucket ?? null},
        ${body.notes ?? null}
      )
      returning id, owner_id, folder_id, name, website, industry, size_bucket,
                notes, created_at, updated_at
    `) as CompanyRow[];
    const created = rows[0];
    await logActivity({
      ownerId: created.owner_id,
      actorId: user.id,
      entityType: "company",
      entityId: created.id,
      verb: "created",
      meta: { name: created.name },
    });
    return NextResponse.json({ company: created }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
