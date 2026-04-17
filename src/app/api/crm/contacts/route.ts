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

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const url = new URL(req.url);
    const folderId = url.searchParams.get("folder_id");
    const companyId = url.searchParams.get("company_id");
    const q = sql();

    let rows: ContactRow[];
    if (folderId) {
      rows = (user.role === "admin"
        ? await q`
            select id, owner_id, folder_id, company_id, first_name, last_name,
                   email, phone, title, notes, created_at, updated_at
            from contacts
            where folder_id = ${Number(folderId)} and deleted_at is null
            order by id desc
          `
        : await q`
            select id, owner_id, folder_id, company_id, first_name, last_name,
                   email, phone, title, notes, created_at, updated_at
            from contacts
            where folder_id = ${Number(folderId)} and owner_id = ${user.id} and deleted_at is null
            order by id desc
          `) as ContactRow[];
    } else if (companyId) {
      rows = (user.role === "admin"
        ? await q`
            select id, owner_id, folder_id, company_id, first_name, last_name,
                   email, phone, title, notes, created_at, updated_at
            from contacts
            where company_id = ${Number(companyId)} and deleted_at is null
            order by id desc
          `
        : await q`
            select id, owner_id, folder_id, company_id, first_name, last_name,
                   email, phone, title, notes, created_at, updated_at
            from contacts
            where company_id = ${Number(companyId)} and owner_id = ${user.id} and deleted_at is null
            order by id desc
          `) as ContactRow[];
    } else {
      rows = (user.role === "admin"
        ? await q`
            select id, owner_id, folder_id, company_id, first_name, last_name,
                   email, phone, title, notes, created_at, updated_at
            from contacts
            where deleted_at is null
            order by updated_at desc
            limit 500
          `
        : await q`
            select id, owner_id, folder_id, company_id, first_name, last_name,
                   email, phone, title, notes, created_at, updated_at
            from contacts
            where owner_id = ${user.id} and deleted_at is null
            order by updated_at desc
            limit 500
          `) as ContactRow[];
    }
    return NextResponse.json({ contacts: rows });
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
    const body = (await req.json()) as Partial<ContactRow>;
    if (!body.first_name && !body.last_name && !body.email && !body.phone) {
      throw new Error("BAD_REQUEST");
    }
    const q = sql();
    const rows = (await q`
      insert into contacts (owner_id, folder_id, company_id, first_name, last_name, email, phone, title, notes)
      values (
        ${user.id},
        ${body.folder_id ?? null},
        ${body.company_id ?? null},
        ${body.first_name ?? null},
        ${body.last_name ?? null},
        ${body.email ?? null},
        ${body.phone ?? null},
        ${body.title ?? null},
        ${body.notes ?? null}
      )
      returning id, owner_id, folder_id, company_id, first_name, last_name,
                email, phone, title, notes, created_at, updated_at
    `) as ContactRow[];
    const created = rows[0];
    await logActivity({
      ownerId: created.owner_id,
      actorId: user.id,
      entityType: "contact",
      entityId: created.id,
      verb: "created",
      meta: { name: `${created.first_name ?? ""} ${created.last_name ?? ""}`.trim() },
    });
    return NextResponse.json({ contact: created }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
