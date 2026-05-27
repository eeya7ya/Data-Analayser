import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { findCrossKindConflicts } from "@/lib/crmNames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Companies — the top of the Company branch in the CRM drill-down.
 *
 *   GET ?q=foo       fuzzy search by name / website / industry / notes,
 *                    with per-row client_folder + quotation counts so the
 *                    listing UI doesn't have to fan out queries.
 *   POST             create a new company. Idempotent on (name, owner_id)
 *                    so a duplicate name from the same user returns the
 *                    existing row instead of erroring out.
 *   PATCH ?id=N      edit metadata. No DELETE handler — archive via
 *                    `archived: true` flips deleted_at, fully reversible.
 *
 * Owner isolation: non-admin users only see / mutate companies they own.
 */

interface CompanyRow {
  id: number;
  name: string;
  website: string | null;
  industry: string | null;
  size_bucket: string | null;
  notes: string | null;
  owner_id: number | null;
  owner_username: string | null;
  created_at: string;
  updated_at: string;
  client_count: number;
  quotation_count: number;
  file_count: number;
  deleted_at: string | null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireModuleAllowLegacy(user, "crm");

    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get("id");
    const search = (searchParams.get("q") ?? "").trim();
    const includeArchived = searchParams.get("include_archived") === "1";
    const isAdmin = canReadAll(user);
    const q = sql();

    // Single-row fetch for the company detail page.
    if (idParam) {
      const id = Number(idParam);
      if (!Number.isFinite(id) || id <= 0) {
        return NextResponse.json({ company: null });
      }
      const rows = (await q`
        select c.id, c.name, c.website, c.industry, c.size_bucket, c.notes,
               c.owner_id, u.username as owner_username,
               c.created_at, c.updated_at,
               (select count(*) from client_folders cf
                  where cf.company_id = c.id and cf.deleted_at is null) as client_count,
               (select count(*) from quotations qq
                  join client_folders cf on cf.id = qq.folder_id
                  where cf.company_id = c.id
                    and qq.deleted_at is null and cf.deleted_at is null) as quotation_count,
               (select count(*) from project_files pf
                  join projects p on p.id = pf.project_id and p.deleted_at is null
                  join client_folders cf on cf.id = p.folder_id and cf.deleted_at is null
                  where cf.company_id = c.id and pf.deleted_at is null) as file_count,
               c.deleted_at
        from companies c
        left join users u on u.id = c.owner_id
        where c.id = ${id}
      `) as CompanyRow[];
      const row = rows[0];
      if (!row) return NextResponse.json({ company: null });
      if (!isAdmin && row.owner_id !== user.id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      return NextResponse.json({ company: row });
    }

    // List query. `q` is a contains-match on name / website / industry /
    // notes; we use the existing search_tsv generated column when no
    // explicit ILIKE filter would help. Keeping it simple here — the
    // 17-row dataset doesn't need plan optimisation.
    // activeOnly = true means "deleted_at IS NULL"; null means "no filter
    // — include archived rows too". Earlier this was a boolean named
    // archivedFilter compared against (deleted_at IS NULL); the polarity
    // was inverted so the default request only returned archived rows,
    // which wiped the SSR-rendered list on client re-fetch.
    const activeOnly = includeArchived ? null : true;
    const ownerFilter = isAdmin ? null : user.id;
    const rows = (await q`
      select c.id, c.name, c.website, c.industry, c.size_bucket, c.notes,
             c.owner_id, u.username as owner_username,
             c.created_at, c.updated_at,
             (select count(*) from client_folders cf
                where cf.company_id = c.id and cf.deleted_at is null) as client_count,
             (select count(*) from quotations qq
                join client_folders cf on cf.id = qq.folder_id
                where cf.company_id = c.id
                  and qq.deleted_at is null and cf.deleted_at is null) as quotation_count,
             (select count(*) from project_files pf
                join projects p on p.id = pf.project_id and p.deleted_at is null
                join client_folders cf on cf.id = p.folder_id and cf.deleted_at is null
                where cf.company_id = c.id and pf.deleted_at is null) as file_count,
             c.deleted_at
      from companies c
      left join users u on u.id = c.owner_id
      where (${activeOnly}::boolean is null or (c.deleted_at is null) = ${activeOnly})
        and (${ownerFilter}::int is null or c.owner_id = ${ownerFilter})
        and (
          ${search} = ''
          or c.name ilike ${"%" + search + "%"}
          or coalesce(c.website, '') ilike ${"%" + search + "%"}
          or coalesce(c.industry, '') ilike ${"%" + search + "%"}
          or coalesce(c.notes, '') ilike ${"%" + search + "%"}
        )
      order by (c.deleted_at is not null), c.name
      limit 500
    `) as CompanyRow[];

    return NextResponse.json({ companies: rows });
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
    const isAdmin = canReadAll(user);

    const body = (await req.json()) as {
      name?: string;
      website?: string | null;
      industry?: string | null;
      size_bucket?: string | null;
      notes?: string | null;
    };
    const name = String(body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }

    // De-dup hard block (V1.3a): a name in the Individual list can't also
    // exist as a Company. Checked before the idempotent reuse so a clean
    // 409 is returned with the conflicting rows for the UI to surface.
    const conflicts = await findCrossKindConflicts({
      name,
      target: "company",
      ownerId: isAdmin ? null : user.id,
    });
    if (conflicts.length > 0) {
      return NextResponse.json(
        {
          error: `"${name}" already exists as an individual client. A name can't be both an individual and a company.`,
          conflict: true,
          matches: conflicts,
        },
        { status: 409 },
      );
    }

    const q = sql();
    // Re-use an existing row owned by the same user (idempotent create).
    const existing = (await q`
      select id, deleted_at from companies
      where owner_id = ${user.id} and lower(name) = lower(${name})
      limit 1
    `) as Array<{ id: number; deleted_at: string | null }>;
    if (existing.length > 0) {
      // If it was archived, un-archive on re-create instead of
      // refusing — the user clearly wants this entity active.
      if (existing[0].deleted_at) {
        await q`update companies set deleted_at = null, updated_at = now() where id = ${existing[0].id}`;
      }
      const rows = (await q`
        select id, name, website, industry, size_bucket, notes,
               owner_id, created_at, updated_at, deleted_at
        from companies where id = ${existing[0].id}
      `) as CompanyRow[];
      return NextResponse.json({ company: rows[0], reused: true });
    }

    const website = body.website?.trim() || null;
    const industry = body.industry?.trim() || null;
    const sizeBucket = body.size_bucket?.trim() || null;
    const notes = body.notes?.trim() || null;

    const inserted = (await q`
      insert into companies (owner_id, name, website, industry, size_bucket, notes)
      values (${user.id}, ${name}, ${website}, ${industry}, ${sizeBucket}, ${notes})
      returning id, name, website, industry, size_bucket, notes,
                owner_id, created_at, updated_at, deleted_at
    `) as CompanyRow[];

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'company', ${inserted[0].id}, 'create',
              ${JSON.stringify({ name, website, industry })}::jsonb)
    `;

    return NextResponse.json({ company: inserted[0] });
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
      name?: string;
      website?: string | null;
      industry?: string | null;
      size_bucket?: string | null;
      notes?: string | null;
      archived?: boolean;
    };

    const q = sql();
    const existing = (await q`
      select owner_id from companies where id = ${id}
    `) as Array<{ owner_id: number | null }>;
    if (existing.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (user.role !== "admin" && existing[0].owner_id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    if (body.name !== undefined) {
      const n = String(body.name).trim();
      if (!n) {
        return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      }
      await q`update companies set name = ${n} where id = ${id}`;
    }
    if (body.website !== undefined) {
      const v = body.website === null ? null : String(body.website).trim() || null;
      await q`update companies set website = ${v} where id = ${id}`;
    }
    if (body.industry !== undefined) {
      const v = body.industry === null ? null : String(body.industry).trim() || null;
      await q`update companies set industry = ${v} where id = ${id}`;
    }
    if (body.size_bucket !== undefined) {
      const v = body.size_bucket === null ? null : String(body.size_bucket).trim() || null;
      await q`update companies set size_bucket = ${v} where id = ${id}`;
    }
    if (body.notes !== undefined) {
      const v = body.notes === null ? null : String(body.notes).trim() || null;
      await q`update companies set notes = ${v} where id = ${id}`;
    }
    if (body.archived !== undefined) {
      await q`
        update companies
        set deleted_at = ${body.archived ? new Date().toISOString() : null}
        where id = ${id}
      `;
    }
    await q`update companies set updated_at = now() where id = ${id}`;

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'company', ${id}, 'update', ${JSON.stringify(body)}::jsonb)
    `;

    const rows = (await q`
      select id, name, website, industry, size_bucket, notes,
             owner_id, created_at, updated_at, deleted_at
      from companies where id = ${id}
    `) as CompanyRow[];
    return NextResponse.json({ company: rows[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
