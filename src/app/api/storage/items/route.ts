import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { hasModule, hasModuleRole } from "@/lib/modules";

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
    const term = (new URL(req.url).searchParams.get("q") || "").trim();
    const q = sql();
    const like = `%${term}%`;
    const rows = (await q`
      select id, vendor, model, category,
             coalesce(nullif(trim(vendor || ' ' || model), ''), model) as label
      from products
      where ${term === ""}::boolean
         or vendor ilike ${like}
         or model ilike ${like}
         or category ilike ${like}
      order by vendor, model
      limit 30
    `) as Array<Record<string, unknown>>;
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
    const body = (await req.json()) as { item_id?: number; reorder_point?: number };
    const itemId = Number(body.item_id);
    const reorder = Number(body.reorder_point);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return NextResponse.json({ error: "item_id is required" }, { status: 400 });
    }
    if (!Number.isInteger(reorder) || reorder < 0) {
      return NextResponse.json(
        { error: "reorder_point must be a whole number ≥ 0" },
        { status: 400 },
      );
    }
    const q = sql();
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
