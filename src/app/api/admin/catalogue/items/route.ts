/**
 * Admin catalogue CRUD endpoint.
 *
 *   GET    /api/admin/catalogue/items?vendor=&category=&q=&active=&page=&pageSize=
 *   POST   /api/admin/catalogue/items                 create one row
 *   PATCH  /api/admin/catalogue/items?id=123          partial update (price / desc / specs / active)
 *   DELETE /api/admin/catalogue/items?id=123          soft delete (active=false)
 *   DELETE /api/admin/catalogue/items?id=123&hard=1   permanent delete
 *
 * PATCH auto-sets `description_locked = true` whenever the body includes a
 * `description` field — the client never sends the flag. AI regeneration
 * skips locked rows unless `--force` is passed.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import { invalidateSystemsCache } from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface CatalogueRow {
  id: number;
  vendor: string;
  category: string;
  sub_category: string | null;
  model: string;
  description: string;
  description_locked: boolean;
  currency: string;
  price_dpp: number | string | null;
  price_si: number | string | null;
  price_end_user: number | string | null;
  specs: Record<string, unknown> | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

function errResponse(err: unknown) {
  const msg = (err as Error).message || "error";
  const status =
    msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
  return NextResponse.json({ error: msg }, { status });
}

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const vendor = searchParams.get("vendor")?.trim() || "";
    const category = searchParams.get("category")?.trim() || "";
    const q = searchParams.get("q")?.trim() || "";
    const activeParam = searchParams.get("active");
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const pageSize = Math.min(
      500,
      Math.max(1, Number(searchParams.get("pageSize") || 50)),
    );
    const offset = (page - 1) * pageSize;

    const active =
      activeParam === null
        ? null
        : activeParam === "false" || activeParam === "0"
          ? false
          : true;

    const db = sql();
    const vendorFilter = vendor ? db`and vendor = ${vendor}` : db``;
    const categoryFilter = category ? db`and category = ${category}` : db``;
    const activeFilter =
      active === null ? db`` : db`and active = ${active}`;
    const likePattern = `%${q}%`;
    const qFilter = q
      ? db`and (
          vendor ilike ${likePattern}
          or category ilike ${likePattern}
          or sub_category ilike ${likePattern}
          or model ilike ${likePattern}
          or description ilike ${likePattern}
          or specs::text ilike ${likePattern}
        )`
      : db``;

    const rows = (await db`
      select id, vendor, category, sub_category, model, description,
             description_locked, currency, price_dpp, price_si,
             price_end_user, specs, active, created_at, updated_at
        from catalogue_items
       where 1 = 1
         ${vendorFilter}
         ${categoryFilter}
         ${activeFilter}
         ${qFilter}
       order by vendor, category, model
       limit ${pageSize}
      offset ${offset}
    `) as CatalogueRow[];

    const countRows = (await db`
      select count(*)::int as n
        from catalogue_items
       where 1 = 1
         ${vendorFilter}
         ${categoryFilter}
         ${activeFilter}
         ${qFilter}
    `) as Array<{ n: number }>;

    const facetRows = (await db`
      select vendor, category, count(*)::int as n
        from catalogue_items
       where active = true
       group by vendor, category
       order by vendor, category
    `) as Array<{ vendor: string; category: string; n: number }>;

    return NextResponse.json({
      items: rows,
      total: countRows[0]?.n || 0,
      page,
      pageSize,
      facets: facetRows,
    });
  } catch (err) {
    return errResponse(err);
  }
}

// ─── POST (create) ──────────────────────────────────────────────────────────

interface UpsertBody {
  vendor?: string;
  category?: string;
  sub_category?: string | null;
  model?: string;
  description?: string;
  currency?: string;
  price_dpp?: number | null;
  price_si?: number | null;
  price_end_user?: number | null;
  specs?: Record<string, unknown>;
  active?: boolean;
}

function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    await ensureSchema();
    const body = (await req.json()) as UpsertBody;
    if (!body.vendor || !body.model) {
      return NextResponse.json(
        { error: "vendor and model required" },
        { status: 400 },
      );
    }
    const db = sql();
    const descriptionLocked = typeof body.description === "string" && body.description.trim() !== "";
    await db`select set_config('app.price_source', 'manual', true)`;
    const rows = (await db`
      insert into catalogue_items (
        vendor, category, sub_category, model, description, description_locked,
        currency, price_dpp, price_si, price_end_user, specs, active
      ) values (
        ${body.vendor},
        ${body.category || ""},
        ${body.sub_category || ""},
        ${body.model},
        ${body.description || ""},
        ${descriptionLocked},
        ${body.currency || "USD"},
        ${toNumOrNull(body.price_dpp)},
        ${toNumOrNull(body.price_si)},
        ${toNumOrNull(body.price_end_user)},
        ${JSON.stringify(body.specs || {})}::jsonb,
        ${body.active !== false}
      )
      on conflict (vendor, category, model) do update set
        sub_category   = excluded.sub_category,
        description    = case when excluded.description <> '' then excluded.description else catalogue_items.description end,
        description_locked = case when excluded.description <> '' then true else catalogue_items.description_locked end,
        currency       = excluded.currency,
        price_dpp      = excluded.price_dpp,
        price_si       = excluded.price_si,
        price_end_user = excluded.price_end_user,
        specs          = catalogue_items.specs || excluded.specs,
        active         = excluded.active,
        updated_at     = now()
      returning id, vendor, category, sub_category, model, description,
                description_locked, currency, price_dpp, price_si,
                price_end_user, specs, active, created_at, updated_at
    `) as CatalogueRow[];
    invalidateSystemsCache();
    return NextResponse.json({ item: rows[0] });
  } catch (err) {
    return errResponse(err);
  }
}

// ─── PATCH (update one) ─────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const body = (await req.json()) as UpsertBody;
    const db = sql();

    // Read current row so we can merge JSONB specs and coalesce scalars in JS
    // instead of trying to express conditional updates in SQL.
    const existing = (await db`
      select * from catalogue_items where id = ${id} limit 1
    `) as CatalogueRow[];
    if (existing.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const row = existing[0];

    const descIncluded = typeof body.description === "string";
    const next = {
      vendor: body.vendor ?? row.vendor,
      category: body.category ?? row.category,
      sub_category: body.sub_category ?? row.sub_category ?? "",
      model: body.model ?? row.model,
      description: descIncluded ? body.description! : row.description,
      description_locked: descIncluded ? true : row.description_locked,
      currency: body.currency ?? row.currency,
      price_dpp:
        body.price_dpp !== undefined
          ? toNumOrNull(body.price_dpp)
          : toNumOrNull(row.price_dpp),
      price_si:
        body.price_si !== undefined
          ? toNumOrNull(body.price_si)
          : toNumOrNull(row.price_si),
      price_end_user:
        body.price_end_user !== undefined
          ? toNumOrNull(body.price_end_user)
          : toNumOrNull(row.price_end_user),
      specs:
        body.specs && typeof body.specs === "object"
          ? { ...(row.specs || {}), ...body.specs }
          : row.specs || {},
      active: body.active ?? row.active,
    };

    // Tag the update so the trigger writes 'manual' on price history rows.
    await db`select set_config('app.price_source', 'manual', true)`;
    await db`
      update catalogue_items set
        vendor             = ${next.vendor},
        category           = ${next.category},
        sub_category       = ${next.sub_category},
        model              = ${next.model},
        description        = ${next.description},
        description_locked = ${next.description_locked},
        currency           = ${next.currency},
        price_dpp          = ${next.price_dpp},
        price_si           = ${next.price_si},
        price_end_user     = ${next.price_end_user},
        specs              = ${JSON.stringify(next.specs)}::jsonb,
        active             = ${next.active}
      where id = ${id}
    `;

    invalidateSystemsCache();
    const out = (await db`
      select id, vendor, category, sub_category, model, description,
             description_locked, currency, price_dpp, price_si,
             price_end_user, specs, active, created_at, updated_at
        from catalogue_items where id = ${id}
    `) as CatalogueRow[];
    return NextResponse.json({ item: out[0] });
  } catch (err) {
    return errResponse(err);
  }
}

// ─── DELETE ─────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    const hard = searchParams.get("hard") === "1";
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const db = sql();
    if (hard) {
      await db`delete from catalogue_items where id = ${id}`;
    } else {
      await db`select set_config('app.price_source', 'manual', true)`;
      await db`update catalogue_items set active = false where id = ${id}`;
    }
    invalidateSystemsCache();
    return NextResponse.json({ ok: true, hard });
  } catch (err) {
    return errResponse(err);
  }
}
