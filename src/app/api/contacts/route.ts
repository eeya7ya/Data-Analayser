import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { ensurePersonFolder } from "@/lib/crmPeople";

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

// People-at-company rows now also carry their linked project folder's
// stats so the unified list can show counts and link straight to the
// folder page without a second fetch.
interface ContactRowWithCounts extends ContactRow {
  project_count: number;
  quotation_count: number;
}

function contactDisplayName(c: {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  id: number;
}): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return name || c.email || c.phone || `Contact #${c.id}`;
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
      select c.id, c.owner_id, c.folder_id, c.company_id,
             c.first_name, c.last_name, c.email, c.phone, c.title, c.notes,
             c.created_at, c.updated_at, c.deleted_at,
             coalesce((select count(*) from projects p
                where p.folder_id = c.folder_id and p.deleted_at is null), 0)::int as project_count,
             coalesce((select count(*) from quotations qq
                where qq.folder_id = c.folder_id and qq.deleted_at is null), 0)::int as quotation_count
      from contacts c
      where (${activeOnly}::boolean is null or (c.deleted_at is null) = ${activeOnly})
        and (${ownerFilter}::int is null or c.owner_id = ${ownerFilter})
        and (${companyId}::int is null or c.company_id = ${companyId})
        and (${folderId}::int is null or c.folder_id = ${folderId})
        and (
          ${search} = ''
          or coalesce(c.first_name, '') ilike ${"%" + search + "%"}
          or coalesce(c.last_name, '')  ilike ${"%" + search + "%"}
          or coalesce(c.email, '')      ilike ${"%" + search + "%"}
          or coalesce(c.phone, '')      ilike ${"%" + search + "%"}
          or coalesce(c.title, '')      ilike ${"%" + search + "%"}
          or coalesce(c.notes, '')      ilike ${"%" + search + "%"}
        )
      order by (c.deleted_at is not null),
               coalesce(c.last_name, ''), coalesce(c.first_name, '')
      limit 500
    `) as ContactRowWithCounts[];

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

    const email = body.email?.trim() || null;
    const phone = body.phone?.trim() || null;

    const inserted = (await q`
      insert into contacts (owner_id, company_id, folder_id,
                            first_name, last_name, email, phone, title, notes)
      values (${user.id}, ${companyId}, ${folderId},
              ${firstName}, ${lastName},
              ${email},
              ${phone},
              ${body.title?.trim() || null},
              ${body.notes?.trim() || null})
      returning id, owner_id, folder_id, company_id,
                first_name, last_name, email, phone, title, notes,
                created_at, updated_at, deleted_at
    `) as ContactRow[];

    let row = inserted[0];

    // When a contact is created at a company without an explicit
    // folder, auto-spawn the project folder for that person so
    // clicking them on the company page lands on their projects
    // immediately — no separate "+ New client" step required.
    if (companyId !== null && row.folder_id === null) {
      const newFolderId = await ensurePersonFolder({
        ownerId: user.id,
        companyId,
        baseName: contactDisplayName(row),
        email,
        phone,
      });
      if (newFolderId !== null) {
        await q`update contacts set folder_id = ${newFolderId} where id = ${row.id}`;
        row = { ...row, folder_id: newFolderId };
      }
    }

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'contact', ${row.id}, 'create',
              ${JSON.stringify({
                company_id: companyId,
                folder_id: row.folder_id,
                first_name: firstName,
                last_name: lastName,
              })}::jsonb)
    `;

    return NextResponse.json({ contact: row });
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
    // When either name part changes, rebuild the linked folder's name
    // from the post-update contact so the two stay in lockstep.
    if (body.first_name !== undefined || body.last_name !== undefined) {
      const synced = (await q`
        select c.folder_id, c.first_name, c.last_name, c.email, c.phone, c.id
        from contacts c
        where c.id = ${id}
      `) as Array<{
        folder_id: number | null;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        phone: string | null;
        id: number;
      }>;
      const c0 = synced[0];
      if (c0 && c0.folder_id !== null) {
        const newName = contactDisplayName(c0);
        await q`
          update client_folders
          set name = ${newName}, updated_at = now()
          where id = ${c0.folder_id} and deleted_at is null
        `.catch(() => {
          // The (owner_id, name) uniqueness constraint can reject a
          // rename if another folder owned by the same user already
          // has that name — leave the existing folder name in place
          // rather than failing the whole edit.
        });
      }
    }
    if (body.email !== undefined) {
      const v = body.email === null ? null : String(body.email).trim() || null;
      await q`update contacts set email = ${v} where id = ${id}`;
      await q`
        update client_folders
        set client_email = ${v}, updated_at = now()
        where id = (select folder_id from contacts where id = ${id})
          and deleted_at is null
      `;
    }
    if (body.phone !== undefined) {
      const v = body.phone === null ? null : String(body.phone).trim() || null;
      await q`update contacts set phone = ${v} where id = ${id}`;
      await q`
        update client_folders
        set client_phone = ${v}, updated_at = now()
        where id = (select folder_id from contacts where id = ${id})
          and deleted_at is null
      `;
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
      const ts = body.archived ? new Date().toISOString() : null;
      await q`
        update contacts
        set deleted_at = ${ts}
        where id = ${id}
      `;
      // Cascade the archive state to the linked project folder so a
      // person and their projects share one lifecycle.
      await q`
        update client_folders
        set deleted_at = ${ts}, updated_at = now()
        where id = (select folder_id from contacts where id = ${id})
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
