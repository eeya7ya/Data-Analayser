export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sql, ensureSchema, rawBinder } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { isPricingAdmin } from "@/lib/pricing/access";

/**
 * Global pricing-project search. Matches the query against project
 * name, manufacturer name and product-line item model — all in one
 * round-trip via EXISTS so we don't hydrate every matching line
 * upfront. Visibility scoping follows the same admin/owner rules as
 * the rest of the pricing API.
 *
 * Query params:
 *   q              — free text, min 2 chars
 *   manufacturerId — optional, narrow to one manufacturer
 *   ownerUserId    — admin-only, narrow to one owner
 *   limit          — default 25, capped at 100
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const term = (searchParams.get("q") ?? "").trim();
    if (term.length < 2) return NextResponse.json([]);

    const limit = Math.min(
      parseInt(searchParams.get("limit") ?? "25", 10) || 25,
      100,
    );
    const restrictMfg = searchParams.get("manufacturerId");
    const ownerParam = searchParams.get("ownerUserId");
    const restrictOwnerId =
      ownerParam != null && Number.isFinite(parseInt(ownerParam, 10))
        ? parseInt(ownerParam, 10)
        : null;

    const like = `%${term}%`;
    const q = sql();
    const admin = isPricingAdmin(user);

    // Allowed manufacturers — admin sees all; user sees only pinned.
    let allowedMfgIds: number[] | null = null;
    if (!admin) {
      const ums = (await q`
        select manufacturer_id from pricing_user_manufacturers
        where user_id = ${user.id} and deleted_at is null
      `) as Array<{ manufacturer_id: number }>;
      allowedMfgIds = ums.map((u) => u.manufacturer_id);
      if (allowedMfgIds.length === 0) return NextResponse.json([]);
    }

    const mfgFilterId = restrictMfg ? parseInt(restrictMfg, 10) : null;

    // Build the WHERE clause with backend-aware placeholders. The postgres.js
    // fragment-composition form (q`and …`) does NOT work on the D1 client — a
    // fragment there is a Promise, not a composable piece — so we assemble the
    // SQL string and bind via rawBinder. P() must be called in the exact order
    // the placeholders appear in the final SQL.
    const { P, params } = rawBinder();

    // 1) matched_in_lines (in SELECT)  2) um.user_id (in JOIN)
    const matchedExists = `exists (select 1 from pricing_product_lines pl where pl.project_id = p.id and pl.item_model ilike ${P(like)})`;
    const joinUser = P(user.id);

    // 3) visibility
    let visibility = "";
    if (admin) {
      if (restrictOwnerId != null) visibility = `and p.user_id = ${P(restrictOwnerId)}`;
    } else {
      const ids = allowedMfgIds!.map((id) => P(id)).join(", ");
      visibility = `and p.user_id = ${P(user.id)} and p.manufacturer_id in (${ids})`;
    }
    // 4) manufacturer narrow
    const mfgFilter =
      mfgFilterId != null && Number.isFinite(mfgFilterId)
        ? `and p.manufacturer_id = ${P(mfgFilterId)}`
        : "";
    // 5) text match
    const textMatch = `(p.name ilike ${P(like)} or m.name ilike ${P(like)} or exists (select 1 from pricing_product_lines pl where pl.project_id = p.id and pl.item_model ilike ${P(like)}))`;
    // 6) limit
    const lim = P(limit);

    const text = `
      select p.id, p.name, p.date, p.responsible_person, p.created_at,
             p.user_id as owner_user_id, p.manufacturer_id,
             m.name as manufacturer_name, um.color as manufacturer_color,
             um.tag as manufacturer_tag, p.parent_project_id, p.revision_number,
             ${matchedExists} as matched_in_lines
      from pricing_projects p
      join pricing_manufacturers m on m.id = p.manufacturer_id
      left join pricing_user_manufacturers um
        on um.manufacturer_id = m.id and um.user_id = ${joinUser} and um.deleted_at is null
      where p.deleted_at is null ${visibility} ${mfgFilter} and ${textMatch}
      order by m.name asc, p.name asc, p.revision_number asc
      limit ${lim}
    `;
    const rows = (await q.unsafe(text, params)) as Array<Record<string, unknown>>;
    return NextResponse.json(rows);
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
