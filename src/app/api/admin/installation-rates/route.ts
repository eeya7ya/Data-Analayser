import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Installation-calculator rate book.
 *
 *   GET    → list every rate (any signed-in user; the Designer calculator
 *            reads these to price an installation).
 *   POST   → add a rate { category, name, unit, unit_cost }   (admin)
 *   PATCH  → edit a rate { id, name?, unit?, unit_cost?, sort?, active? } (admin)
 *   DELETE ?id=N → remove a rate                               (admin)
 *
 * One flat table covers conduit / cable (per metre), labour (per day),
 * location/region uplift, and misc accessories — `category` + `unit` tell
 * the calculator how to apply each `unit_cost`.
 */

const CATEGORIES = ["conduit", "cable", "labor", "location", "accessory"] as const;
const UNITS = ["meter", "day", "piece", "percent", "fixed"] as const;

type RateRow = {
  id: number;
  category: string;
  name: string;
  unit: string;
  unit_cost: number;
  sort: number;
  active: boolean;
};

export async function GET() {
  try {
    await requireUser();
    await ensureSchema();
    const q = sql();
    const rates = (await q`
      select id, category, name, unit, unit_cost::float8 as unit_cost, sort, active
      from installation_rates
      order by category, sort, name
    `) as RateRow[];
    return NextResponse.json({ rates });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    await ensureSchema();
    const body = (await req.json()) as {
      category?: string;
      name?: string;
      unit?: string;
      unit_cost?: number;
    };
    const category = String(body.category || "");
    const name = String(body.name || "").trim();
    const unit = String(body.unit || "meter");
    const unitCost = Number(body.unit_cost ?? 0);
    if (!(CATEGORIES as readonly string[]).includes(category)) {
      return NextResponse.json({ error: "invalid category" }, { status: 400 });
    }
    if (!(UNITS as readonly string[]).includes(unit)) {
      return NextResponse.json({ error: "invalid unit" }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      return NextResponse.json(
        { error: "unit_cost must be a number ≥ 0" },
        { status: 400 },
      );
    }
    const q = sql();
    const rows = (await q`
      insert into installation_rates (category, name, unit, unit_cost, sort)
      values (
        ${category}, ${name.slice(0, 120)}, ${unit}, ${unitCost},
        coalesce((select max(sort) + 1 from installation_rates where category = ${category}), 0)
      )
      returning id, category, name, unit, unit_cost::float8 as unit_cost, sort, active
    `) as RateRow[];
    return NextResponse.json({ rate: rows[0] });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    await ensureSchema();
    const body = (await req.json()) as {
      id?: number;
      name?: string;
      unit?: string;
      unit_cost?: number;
      sort?: number;
      active?: boolean;
    };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const q = sql();
    if (typeof body.name === "string") {
      const n = body.name.trim();
      if (n) await q`update installation_rates set name = ${n.slice(0, 120)}, updated_at = now() where id = ${id}`;
    }
    if (typeof body.unit === "string" && (UNITS as readonly string[]).includes(body.unit)) {
      await q`update installation_rates set unit = ${body.unit}, updated_at = now() where id = ${id}`;
    }
    if (body.unit_cost !== undefined) {
      const c = Number(body.unit_cost);
      if (Number.isFinite(c) && c >= 0) {
        await q`update installation_rates set unit_cost = ${c}, updated_at = now() where id = ${id}`;
      }
    }
    if (body.sort !== undefined && Number.isFinite(Number(body.sort))) {
      await q`update installation_rates set sort = ${Math.trunc(Number(body.sort))}, updated_at = now() where id = ${id}`;
    }
    if (typeof body.active === "boolean") {
      await q`update installation_rates set active = ${body.active}, updated_at = now() where id = ${id}`;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
    await ensureSchema();
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const q = sql();
    await q`delete from installation_rates where id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const status =
    msg === "FORBIDDEN" ? 403 : msg === "UNAUTHENTICATED" ? 401 : 500;
  return NextResponse.json({ error: msg }, { status });
}
