import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { hasModule, hasModuleRole } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Storage stock per (product, location).
 *
 *   GET    — any storage.* / projects.* / admin user. Filters by
 *            location_id or product query.
 *   PATCH  — storage.manager or admin. Sets on_hand to an absolute
 *            value (no math here — the caller passes the new
 *            number). `reserved` is managed by the request workflow,
 *            not adjustable directly.
 *
 * Stock rows are UPSERTed on (product_id, location_id). Setting
 * on_hand=0 is allowed; deleting a row is not — a zero-stock row is
 * still useful history.
 */

interface StockRow {
  product_id: number;
  product_model: string;
  product_vendor: string;
  location_id: number;
  location_name: string;
  on_hand: number;
  reserved: number;
  updated_at: string;
}

async function canRead(userId: number, userRole: string): Promise<boolean> {
  if (userRole === "admin") return true;
  if (await hasModule(userId, "storage")) return true;
  if (await hasModule(userId, "projects")) return true;
  return false;
}

async function canManage(userId: number, userRole: string): Promise<boolean> {
  if (userRole === "admin") return true;
  return hasModuleRole(userId, "storage", "manager");
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    if (!(await canRead(user.id, user.role))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const { searchParams } = new URL(req.url);
    const locationIdParam = searchParams.get("location_id");
    const search = searchParams.get("q")?.trim() ?? "";

    const q = sql();
    const locationId = locationIdParam ? Number(locationIdParam) : null;

    let rows: StockRow[];
    if (locationId !== null && Number.isFinite(locationId)) {
      rows = (await q`
        select ss.product_id, p.model as product_model, p.vendor as product_vendor,
               ss.location_id, sl.name as location_name,
               ss.on_hand, ss.reserved, ss.updated_at
        from storage_stock ss
        join products p on p.id = ss.product_id
        join storage_locations sl on sl.id = ss.location_id
        where ss.location_id = ${locationId}
          and (${search} = '' or p.model ilike ${"%" + search + "%"}
                              or p.vendor ilike ${"%" + search + "%"})
        order by p.vendor, p.model
        limit 500
      `) as StockRow[];
    } else {
      rows = (await q`
        select ss.product_id, p.model as product_model, p.vendor as product_vendor,
               ss.location_id, sl.name as location_name,
               ss.on_hand, ss.reserved, ss.updated_at
        from storage_stock ss
        join products p on p.id = ss.product_id
        join storage_locations sl on sl.id = ss.location_id
        where (${search} = '' or p.model ilike ${"%" + search + "%"}
                              or p.vendor ilike ${"%" + search + "%"})
        order by sl.name, p.vendor, p.model
        limit 500
      `) as StockRow[];
    }
    return NextResponse.json({ stock: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    await ensureSchema();
    if (!(await canManage(user.id, user.role))) {
      return NextResponse.json(
        { error: "requires storage.manager or admin" },
        { status: 403 },
      );
    }
    const body = (await req.json()) as {
      product_id?: number;
      location_id?: number;
      on_hand?: number;
    };
    const productId = Number(body.product_id);
    const locationId = Number(body.location_id);
    const onHand = Number(body.on_hand);
    if (!Number.isInteger(productId) || productId <= 0) {
      return NextResponse.json({ error: "invalid product_id" }, { status: 400 });
    }
    if (!Number.isInteger(locationId) || locationId <= 0) {
      return NextResponse.json({ error: "invalid location_id" }, { status: 400 });
    }
    if (!Number.isInteger(onHand) || onHand < 0) {
      return NextResponse.json(
        { error: "on_hand must be a non-negative integer" },
        { status: 400 },
      );
    }

    const q = sql();
    // Cross-check that both rows exist before we UPSERT to give a
    // useful 404 instead of a foreign-key violation.
    const checks = (await q`
      select
        (select count(*) from products where id = ${productId}) as product_ok,
        (select count(*) from storage_locations where id = ${locationId} and deleted_at is null) as location_ok
    `) as Array<{ product_ok: number; location_ok: number }>;
    if (checks[0].product_ok === 0) {
      return NextResponse.json({ error: "product not found" }, { status: 404 });
    }
    if (checks[0].location_ok === 0) {
      return NextResponse.json(
        { error: "location not found or archived" },
        { status: 404 },
      );
    }

    await q`
      insert into storage_stock (product_id, location_id, on_hand, reserved, updated_at)
      values (${productId}, ${locationId}, ${onHand}, 0, now())
      on conflict (product_id, location_id) do update
        set on_hand = excluded.on_hand,
            updated_at = now()
    `;

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'storage_stock', ${productId}, 'set_on_hand',
              ${JSON.stringify({ location_id: locationId, on_hand: onHand })}::jsonb)
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
