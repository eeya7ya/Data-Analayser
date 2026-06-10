import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Installation Calculator preset catalogue.
 *
 * The price book the Designer's Installation Calculator picker draws
 * from: conduits, cables, technician fees, … grouped by category.
 * Selling price is always derived (sell = cost × 100 / (100 − margin)),
 * matching the costing-sheet convention, so only cost + margin are stored.
 *
 *   GET    — any signed-in user. Active items only; admins may pass
 *            ?all=1 to also see inactive ones (the setup page does).
 *   POST   — admin. Create one item.
 *   PATCH  — admin. Update one item by id (partial body).
 *   DELETE — admin. Soft-delete one item (?id=).
 */

export interface InstallationCalcItem {
  id: number;
  category: string;
  name: string;
  unit: string;
  unit_cost: number;
  margin_percent: number;
  sort_order: number;
  active: boolean;
}

function rowToItem(r: Record<string, unknown>): InstallationCalcItem {
  return {
    id: Number(r.id),
    category: String(r.category),
    name: String(r.name),
    unit: String(r.unit),
    unit_cost: Number(r.unit_cost) || 0,
    margin_percent: Number(r.margin_percent) || 0,
    sort_order: Number(r.sort_order) || 0,
    active: Boolean(r.active),
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const all =
      new URL(req.url).searchParams.get("all") === "1" &&
      user.role === "admin";
    const q = sql();
    const rows = (await q`
      select id, category, name, unit, unit_cost, margin_percent,
             sort_order, active
      from installation_calc_items
      where deleted_at is null
        and (${all}::boolean or active)
      order by category, sort_order, id
    `) as Array<Record<string, unknown>>;
    return NextResponse.json({ items: rows.map(rowToItem) });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}

/** Shared body validation for POST / PATCH. Returns only provided keys. */
function readBody(body: Record<string, unknown>) {
  const out: {
    category?: string;
    name?: string;
    unit?: string;
    unit_cost?: number;
    margin_percent?: number;
    sort_order?: number;
    active?: boolean;
  } = {};
  if (typeof body.category === "string") out.category = body.category.trim();
  if (typeof body.name === "string") out.name = body.name.trim();
  if (typeof body.unit === "string") out.unit = body.unit.trim() || "pcs";
  if (body.unit_cost !== undefined) {
    const n = Number(body.unit_cost);
    out.unit_cost = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  if (body.margin_percent !== undefined) {
    const n = Number(body.margin_percent);
    out.margin_percent = Number.isFinite(n) ? Math.min(Math.max(n, 0), 95) : 25;
  }
  if (body.sort_order !== undefined) {
    const n = Number(body.sort_order);
    out.sort_order = Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  if (typeof body.active === "boolean") out.active = body.active;
  return out;
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    await ensureSchema();
    const body = readBody((await req.json()) as Record<string, unknown>);
    if (!body.category || !body.name) {
      return NextResponse.json(
        { error: "category and name are required." },
        { status: 400 },
      );
    }
    const q = sql();
    const rows = (await q`
      insert into installation_calc_items
        (category, name, unit, unit_cost, margin_percent, sort_order, active)
      values (
        ${body.category}, ${body.name}, ${body.unit ?? "pcs"},
        ${body.unit_cost ?? 0}, ${body.margin_percent ?? 25},
        ${body.sort_order ?? 0}, ${body.active ?? true}
      )
      returning id, category, name, unit, unit_cost, margin_percent,
                sort_order, active
    `) as Array<Record<string, unknown>>;
    return NextResponse.json({ item: rowToItem(rows[0]) });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      {
        status:
          msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500,
      },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    await ensureSchema();
    const raw = (await req.json()) as Record<string, unknown>;
    const id = Number(raw.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }
    const body = readBody(raw);
    if (body.category === "" || body.name === "") {
      return NextResponse.json(
        { error: "category and name cannot be empty." },
        { status: 400 },
      );
    }
    const q = sql();
    const rows = (await q`
      update installation_calc_items set
        category       = coalesce(${body.category ?? null}, category),
        name           = coalesce(${body.name ?? null}, name),
        unit           = coalesce(${body.unit ?? null}, unit),
        unit_cost      = coalesce(${body.unit_cost ?? null}, unit_cost),
        margin_percent = coalesce(${body.margin_percent ?? null}, margin_percent),
        sort_order     = coalesce(${body.sort_order ?? null}, sort_order),
        active         = coalesce(${body.active ?? null}, active),
        updated_at     = now()
      where id = ${id} and deleted_at is null
      returning id, category, name, unit, unit_cost, margin_percent,
                sort_order, active
    `) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Item not found." }, { status: 404 });
    }
    return NextResponse.json({ item: rowToItem(rows[0]) });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      {
        status:
          msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500,
      },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
    await ensureSchema();
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }
    const q = sql();
    await q`
      update installation_calc_items
      set deleted_at = now(), updated_at = now()
      where id = ${id} and deleted_at is null
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      {
        status:
          msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500,
      },
    );
  }
}
