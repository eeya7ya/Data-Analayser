import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Named contacts (people) inside a Company. The `contacts` table has
 * been in the schema since the CRM foundation migration — this is the
 * first endpoint that exposes it to the UI.
 *
 *   GET    ?company_id=N&q=foo    contacts at one company, filtered
 *                                 by name / email / phone / title
 *   GET    ?id=N                  single row
 *   POST                          create. owner_id is the current user.
 *                                 At least one of company_id or
 *                                 folder_id should be present so the
 *                                 contact has a parent — we don't block
 *                                 floating contacts but they only
 *                                 surface from the global search.
 *   PATCH  ?id=N                  edit metadata.
 *   No DELETE handler — soft-archive via PATCH { archived: true }.
 *
 * Owner isolation: non-admins only see contacts they own.
 */

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
  deleted_at: string | null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireModuleAllowLegacy(user, "crm");

    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get("id");
    const companyIdParam = searchParams.get("company_id");
    const folderIdParam = searchParams.get("folder_id");
    const search = (searchParams.get("q") ?? "").trim();
    const includeArchived = searchParams.get("include_archived") === "1";

    const q = sql();
    const isAdmin = user.role === "admin";
    const ownerFilter = isAdmin ? null : user.id;

    if (idParam) {
      const id = Number(idParam);
      if (!Number.isFinite(id) || id <= 0) {
        return NextResponse.json({ contact: null });
      }
      const rows = (await q`
        select id, owner_id, folder_id, company_id,
               first_name, last_name, email, phone, title, notes,
               created_at, updated_at, deleted_at
        from contacts where id = ${id}
      `) as ContactRow[];
      const row = rows[0];
      if (!row) return NextResponse.json({ contact: null });
      if (!isAdmin && row.owner_id !== user.id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      return NextResponse.json({ contact: row });
    }

    const companyId = companyIdParam ? Number(companyIdParam) : null;
    const folderId = folderIdParam ? Number(folderIdParam) : null;
    // true → only deleted_at IS NULL rows; null → no archived filter.
    const activeOnly = includeArchived ? null : true;

    const rows = (await q`
      select id, owner_id, folder_id, company_id,
             first_name, last_name, email, phone, title, notes,
             created_at, updated_at, deleted_at
      from contacts
      where (${activeOnly}::boolean is null or (deleted_at is null) = ${activeOnly})
        and (${ownerFilter}::int is null or owner_id = ${ownerFilter})
        and (${companyId}::int is null or company_id = ${companyId})
        and (${folderId}::int is null or folder_id = ${folderId})
        and (
          ${search} = ''
          or coalesce(first_name, '') ilike ${"%" + search + "%"}
          or coalesce(last_name, '')  ilike ${"%" + search + "%"}
          or coalesce(email, '')      ilike ${"%" + search + "%"}
          or coalesce(phone, '')      ilike ${"%" + search + "%"}
          or coalesce(title, '')      ilike ${"%" + search + "%"}
          or coalesce(notes, '')      ilike ${"%" + search + "%"}
        )
      order by (deleted_at is not null),
               coalesce(last_name, ''), coalesce(first_name, '')
      limit 500
    `) as ContactRow[];

    return NextResponse.json({ contacts: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireModuleAllowLegacy(user, "crm");

    const body = (await req.json()) as {
      company_id?: number | null;
      folder_id?: number | null;
      first_name?: string | null;
      last_name?: string | null;
      email?: string | null;
      phone?: string | null;
      title?: string | null;
      notes?: string | null;
    };

    const firstName = body.first_name?.trim() || null;
    const lastName = body.last_name?.trim() || null;
    if (!firstName && !lastName && !body.email && !body.phone) {
      return NextResponse.json(
        { error: "at least one of first_name, last_name, email, phone is required" },
        { status: 400 },
      );
    }
    const companyId =
      body.company_id !== undefined && body.company_id !== null
        ? Number(body.company_id)
        : null;
    const folderId =
      body.folder_id !== undefined && body.folder_id !== null
        ? Number(body.folder_id)
        : null;

    const q = sql();
    if (companyId !== null) {
      const check = (await q`
        select id from companies where id = ${companyId} and deleted_at is null
      `) as Array<{ id: number }>;
      if (check.length === 0) {
        return NextResponse.json({ error: "company not found" }, { status: 404 });
      }
    }
    if (folderId !== null) {
      const check = (await q`
        select id from client_folders where id = ${folderId} and deleted_at is null
      `) as Array<{ id: number }>;
      if (check.length === 0) {
        return NextResponse.json({ error: "folder not found" }, { status: 404 });
      }
    }

    const inserted = (await q`
      insert into contacts (owner_id, company_id, folder_id,
                            first_name, last_name, email, phone, title, notes)
      values (${user.id}, ${companyId}, ${folderId},
              ${firstName}, ${lastName},
              ${body.email?.trim() || null},
              ${body.phone?.trim() || null},
              ${body.title?.trim() || null},
              ${body.notes?.trim() || null})
      returning id, owner_id, folder_id, company_id,
                first_name, last_name, email, phone, title, notes,
                created_at, updated_at, deleted_at
    `) as ContactRow[];

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'contact', ${inserted[0].id}, 'create',
              ${JSON.stringify({
                company_id: companyId,
                folder_id: folderId,
                first_name: firstName,
                last_name: lastName,
              })}::jsonb)
    `;

    return NextResponse.json({ contact: inserted[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireModuleAllowLegacy(user, "crm");

    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }

    const body = (await req.json()) as {
      first_name?: string | null;
      last_name?: string | null;
      email?: string | null;
      phone?: string | null;
      title?: string | null;
      notes?: string | null;
      company_id?: number | null;
      folder_id?: number | null;
      archived?: boolean;
    };

    const q = sql();
    const existing = (await q`
      select owner_id from contacts where id = ${id}
    `) as Array<{ owner_id: number | null }>;
    if (existing.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (user.role !== "admin" && existing[0].owner_id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    if (body.first_name !== undefined) {
      const v = body.first_name === null ? null : String(body.first_name).trim() || null;
      await q`update contacts set first_name = ${v} where id = ${id}`;
    }
    if (body.last_name !== undefined) {
      const v = body.last_name === null ? null : String(body.last_name).trim() || null;
      await q`update contacts set last_name = ${v} where id = ${id}`;
    }
    if (body.email !== undefined) {
      const v = body.email === null ? null : String(body.email).trim() || null;
      await q`update contacts set email = ${v} where id = ${id}`;
    }
    if (body.phone !== undefined) {
      const v = body.phone === null ? null : String(body.phone).trim() || null;
      await q`update contacts set phone = ${v} where id = ${id}`;
    }
    if (body.title !== undefined) {
      const v = body.title === null ? null : String(body.title).trim() || null;
      await q`update contacts set title = ${v} where id = ${id}`;
    }
    if (body.notes !== undefined) {
      const v = body.notes === null ? null : String(body.notes).trim() || null;
      await q`update contacts set notes = ${v} where id = ${id}`;
    }
    if (body.company_id !== undefined) {
      const v = body.company_id === null ? null : Number(body.company_id);
      await q`update contacts set company_id = ${v} where id = ${id}`;
    }
    if (body.folder_id !== undefined) {
      const v = body.folder_id === null ? null : Number(body.folder_id);
      await q`update contacts set folder_id = ${v} where id = ${id}`;
    }
    if (body.archived !== undefined) {
      await q`
        update contacts
        set deleted_at = ${body.archived ? new Date().toISOString() : null}
        where id = ${id}
      `;
    }
    await q`update contacts set updated_at = now() where id = ${id}`;

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'contact', ${id}, 'update', ${JSON.stringify(body)}::jsonb)
    `;

    const rows = (await q`
      select id, owner_id, folder_id, company_id,
             first_name, last_name, email, phone, title, notes,
             created_at, updated_at, deleted_at
      from contacts where id = ${id}
    `) as ContactRow[];
    return NextResponse.json({ contact: rows[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
