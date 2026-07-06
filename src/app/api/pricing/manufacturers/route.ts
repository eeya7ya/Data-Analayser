export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, requireWriter } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import {
  DEFAULT_USER_COLOR,
  isPricingAdmin,
} from "@/lib/pricing/access";

interface ManufacturerCardRow {
  id: number;
  name: string;
  color: string;
  tag: string;
  createdAt: string;
  ownerUserId: number;
  ownerUserName: string;
  projectCount: number;
}

/**
 * List the pricing manufacturers visible to the caller.
 *
 *   • Admins / viewers — one card per (user × manufacturer) pin so each
 *     person's pricing-sheet workspace is browsable from the top-level
 *     listing.
 *   • Regular users — only their own pins.
 *
 * Project counts are scoped to the same (manufacturer × user) pair so
 * cards reflect the *owner's* sheet count, not the global total.
 */
export async function GET() {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const q = sql();

    if (isPricingAdmin(user)) {
      const rows = (await q`
        select
          m.id          as manufacturer_id,
          m.name        as name,
          um.color      as um_color,
          um.tag        as um_tag,
          um.created_at as created_at,
          u.id          as owner_user_id,
          u.display_name as owner_display_name,
          u.username    as owner_username
        from pricing_user_manufacturers um
        join pricing_manufacturers m on m.id = um.manufacturer_id
        join users u on u.id = um.user_id
        where um.deleted_at is null
          and m.deleted_at is null
        order by u.display_name, m.name
      `) as Array<{
        manufacturer_id: number;
        name: string;
        um_color: string;
        um_tag: string;
        created_at: string;
        owner_user_id: number;
        owner_display_name: string | null;
        owner_username: string;
      }>;

      if (rows.length === 0) return NextResponse.json([]);

      const pairs = rows.map((r) => `${r.manufacturer_id}:${r.owner_user_id}`);
      const mfgIds = Array.from(new Set(rows.map((r) => r.manufacturer_id)));
      const userIds = Array.from(new Set(rows.map((r) => r.owner_user_id)));

      // count per (manufacturer × user). Filter once on each side, then
      // group in JS — keeps the SQL trivial and uses the partial indexes.
      const counts = (await q`
        select manufacturer_id, user_id, count(*)::int as n
        from pricing_projects
        where deleted_at is null
          and manufacturer_id = any(${mfgIds}::int[])
          and user_id = any(${userIds}::int[])
        group by manufacturer_id, user_id
      `) as Array<{ manufacturer_id: number; user_id: number; n: number }>;
      const countMap = new Map<string, number>();
      for (const c of counts) {
        if (c.user_id == null) continue;
        countMap.set(`${c.manufacturer_id}:${c.user_id}`, Number(c.n));
      }
      void pairs; // keep keying logic obvious

      const out: ManufacturerCardRow[] = rows.map((r) => ({
        id: r.manufacturer_id,
        name: r.name,
        color: r.um_color || DEFAULT_USER_COLOR,
        tag: r.um_tag?.trim() ? r.um_tag : r.owner_username,
        createdAt: r.created_at,
        ownerUserId: r.owner_user_id,
        ownerUserName: r.owner_display_name || r.owner_username,
        projectCount: countMap.get(`${r.manufacturer_id}:${r.owner_user_id}`) ?? 0,
      }));
      return NextResponse.json(out);
    }

    // Non-admin: just the user's own pins.
    const rows = (await q`
      select
        m.id          as id,
        m.name        as name,
        um.color      as color,
        um.tag        as tag,
        um.created_at as created_at
      from pricing_user_manufacturers um
      join pricing_manufacturers m on m.id = um.manufacturer_id
      where um.user_id = ${user.id}
        and um.deleted_at is null
        and m.deleted_at is null
      order by um.created_at asc
    `) as Array<{
      id: number;
      name: string;
      color: string;
      tag: string;
      created_at: string;
    }>;
    if (rows.length === 0) return NextResponse.json([]);

    const mfgIds = rows.map((r) => r.id);
    const counts = (await q`
      select manufacturer_id, count(*)::int as n
      from pricing_projects
      where deleted_at is null
        and user_id = ${user.id}
        and manufacturer_id = any(${mfgIds}::int[])
      group by manufacturer_id
    `) as Array<{ manufacturer_id: number; n: number }>;
    const countMap = new Map<number, number>();
    for (const c of counts) countMap.set(c.manufacturer_id, Number(c.n));

    const out: ManufacturerCardRow[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      tag: r.tag,
      createdAt: r.created_at,
      ownerUserId: user.id,
      ownerUserName: user.display_name || user.username,
      projectCount: countMap.get(r.id) ?? 0,
    }));
    return NextResponse.json(out);
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/**
 * Pin a manufacturer for the caller. Find-or-create at the global
 * pricing_manufacturers level so two users typing the same vendor name
 * share one row; the per-user pin row carries colour/tag. Restoring a
 * previously-soft-deleted pin is treated as creation so users can
 * reverse a mistaken unpin.
 */
export async function POST(req: Request) {
  try {
    const user = await requireWriter();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();

    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      defaultShippingRate?: number | string | null;
      defaultCustomsRate?: number | string | null;
      defaultProfitMargin?: number | string | null;
    };
    const name = (body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Per-manufacturer pricing defaults (decimals, e.g. 0.35 = 35%). A missing
    // / blank value stays NULL — new sheets then fall back to the global
    // default constants for that field.
    const rate = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : parseFloat(String(v));
      return Number.isFinite(n) ? n : null;
    };
    const dShip = rate(body.defaultShippingRate);
    const dCust = rate(body.defaultCustomsRate);
    const dProfit = rate(body.defaultProfitMargin);
    const hasDefaults = dShip !== null || dCust !== null || dProfit !== null;

    const q = sql();
    const color = DEFAULT_USER_COLOR;
    const tag = user.username;

    // Find-or-create the global manufacturer.
    const found = (await q`
      select id, name, color, tag, created_by_user_id
      from pricing_manufacturers
      where name = ${name} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      name: string;
      color: string | null;
      tag: string | null;
      created_by_user_id: number | null;
    }>;
    let manufacturer = found[0];
    if (!manufacturer) {
      const ins = (await q`
        insert into pricing_manufacturers
          (name, created_by_user_id, default_shipping_rate,
           default_customs_rate, default_profit_margin)
        values (${name}, ${user.id}, ${dShip}, ${dCust}, ${dProfit})
        returning id, name, color, tag, created_by_user_id
      `) as Array<typeof manufacturer>;
      manufacturer = ins[0];
    } else if (hasDefaults) {
      // Existing manufacturer — refresh its defaults from this request.
      await q`
        update pricing_manufacturers
        set default_shipping_rate = ${dShip},
            default_customs_rate = ${dCust},
            default_profit_margin = ${dProfit}
        where id = ${manufacturer.id}
      `;
    }

    // Existing pin (even if soft-deleted) ↔ user.
    const existingRows = (await q`
      select id, color, tag, deleted_at
      from pricing_user_manufacturers
      where user_id = ${user.id} and manufacturer_id = ${manufacturer.id}
      limit 1
    `) as Array<{
      id: number;
      color: string;
      tag: string;
      deleted_at: string | null;
    }>;

    let userMfg: { color: string; tag: string };
    if (existingRows.length > 0) {
      const ex = existingRows[0];
      if (!ex.deleted_at) {
        return NextResponse.json(
          { error: "You already have this manufacturer" },
          { status: 409 },
        );
      }
      const restored = (await q`
        update pricing_user_manufacturers
        set color = ${color}, tag = ${tag}, deleted_at = null
        where id = ${ex.id}
        returning color, tag
      `) as Array<{ color: string; tag: string }>;
      userMfg = restored[0];
    } else {
      const created = (await q`
        insert into pricing_user_manufacturers (user_id, manufacturer_id, color, tag)
        values (${user.id}, ${manufacturer.id}, ${color}, ${tag})
        returning color, tag
      `) as Array<{ color: string; tag: string }>;
      userMfg = created[0];
    }

    return NextResponse.json(
      { ...manufacturer, color: userMfg.color, tag: userMfg.tag },
      { status: 201 },
    );
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
