import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema, usingD1, rawBinder } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { hasModule, hasModuleRole } from "@/lib/modules";
import { tokenize } from "@/lib/search";
import { isFtsReady, matchAll, ftsPredicate } from "@/lib/fts";

export const runtime = "nodejs";

/**
 * Storage V1.5A — item helpers.
 *   GET  /api/storage/items?q=…  → search the products catalogue for the
 *        movement picker (any product can receive stock).
 *   PATCH { item_id, reorder_point } → set the per-item reorder point
 *        (Feature 2). Manager / admin only.
 */

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const isAdmin = canReadAll(user);
    if (!isAdmin && !(await hasModule(user.id, "storage"))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const params = new URL(req.url).searchParams;
    const q = sql();

    // Scan path: an exact lookup by scanned code. Match an explicit barcode
    // first, then fall back to the model (many scanners encode the part
    // number), so scanning works even before any barcode is mapped.
    const code = (params.get("code") || "").trim();
    if (code) {
      const rows = (await q`
        select id, vendor, model, category, barcode,
               coalesce(nullif(trim(vendor || ' ' || model), ''), model) as label
        from products
        where lower(barcode) = lower(${code})
           or lower(model) = lower(${code})
        order by (lower(barcode) = lower(${code})) desc, vendor, model
        limit 10
      `) as Array<Record<string, unknown>>;
      return NextResponse.json({ items: rows });
    }

    const term = (params.get("q") || "").trim();
    const { P, params: bind } = rawBinder();
    let whereSql = "";
    if (term !== "") {
      let hay: string | undefined;
      if (usingD1() && isFtsReady()) {
        const match = matchAll(tokenize(term));
        if (match) hay = ftsPredicate("products", "id", P(match));
      }
      if (!hay) {
        const like = `%${term}%`;
        hay = `(vendor ilike ${P(like)} or model ilike ${P(like)} or category ilike ${P(like)})`;
      }
      whereSql = `where ${hay}`;
    }
    const rows = (await q.unsafe(
      `select id, vendor, model, category, barcode,
              coalesce(nullif(trim(vendor || ' ' || model), ''), model) as label
       from products
       ${whereSql}
       order by vendor, model
       limit 30`,
      bind,
    )) as Array<Record<string, unknown>>;
    return NextResponse.json({ items: rows });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const isAdmin = canReadAll(user);
    if (!isAdmin && !(await hasModuleRole(user.id, "storage", "manager"))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const body = (await req.json()) as {
      item_id?: number;
      reorder_point?: number;
      barcode?: string | null;
    };
    const itemId = Number(body.item_id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return NextResponse.json({ error: "item_id is required" }, { status: 400 });
    }
    const q = sql();

    // Map a scanned code to this product (or clear it with null/empty).
    if (body.barcode !== undefined) {
      const bc =
        body.barcode === null || String(body.barcode).trim() === ""
          ? null
          : String(body.barcode).trim().slice(0, 200);
      try {
        await q`
          update products set barcode = ${bc}, updated_at = now()
          where id = ${itemId}
        `;
      } catch {
        // barcode column may predate the migration on a cold cache — ignore.
      }
      return NextResponse.json({ ok: true });
    }

    const reorder = Number(body.reorder_point);
    if (!Number.isInteger(reorder) || reorder < 0) {
      return NextResponse.json(
        { error: "reorder_point must be a whole number ≥ 0" },
        { status: 400 },
      );
    }
    await q`
      insert into stock_item_settings (item_id, reorder_point, updated_at)
      values (${itemId}, ${reorder}, now())
      on conflict (item_id)
      do update set reorder_point = ${reorder}, updated_at = now()
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}
