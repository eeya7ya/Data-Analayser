export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { isPricingAdmin } from "@/lib/pricing/access";
import {
  calculateRow,
  DEFAULT_CONSTANTS,
  type Constants,
} from "@/lib/pricing/calculations";

/**
 * Deep item search. Where /api/pricing/projects/search answers "which
 * projects mention this item", this answers the finer question the
 * pricing team actually asks: "this exact item — what did it cost me,
 * when, and under which project?".
 *
 * It returns one row per matching product line (not per project), with
 * the landed cost and final sell price computed from each project's own
 * constants snapshot so the numbers match what the sheet shows. Results
 * can be sorted by date or cost.
 *
 * Visibility scoping mirrors the rest of the pricing API: admins see
 * every line; regular users see only lines inside their own projects in
 * manufacturers they have pinned.
 *
 * Query params:
 *   q              — item text, min 2 chars (matched against item_model)
 *   manufacturerId — optional, narrow to one manufacturer
 *   ownerUserId    — admin-only, narrow to one owner
 *   sort           — date_desc (default) | date_asc | cost_desc | cost_asc
 *   limit          — default 200, capped at 500
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
      parseInt(searchParams.get("limit") ?? "200", 10) || 200,
      500,
    );
    const sort = searchParams.get("sort") ?? "date_desc";
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

    const visibilityFragment = admin
      ? restrictOwnerId != null
        ? q`and p.user_id = ${restrictOwnerId}`
        : q``
      : q`and p.user_id = ${user.id}
         and p.manufacturer_id = any(${allowedMfgIds!}::int[])`;
    const mfgFragment =
      mfgFilterId != null && Number.isFinite(mfgFilterId)
        ? q`and p.manufacturer_id = ${mfgFilterId}`
        : q``;

    // One row per matching line, carrying the project's constants snapshot
    // and any per-line override so we can reproduce the sheet's numbers.
    const rows = (await q`
      select
        pl.id                       as line_id,
        pl.item_model               as item_model,
        pl.price_usd                as price_usd,
        pl.quantity                 as quantity,
        pl.shipping_override        as shipping_override,
        pl.customs_override         as customs_override,
        pl.shipping_rate_override   as shipping_rate_override,
        pl.customs_rate_override    as customs_rate_override,
        pl.profit_rate_override     as profit_rate_override,
        p.id                        as project_id,
        p.name                      as project_name,
        p.date                      as project_date,
        p.responsible_person        as responsible_person,
        p.revision_number           as revision_number,
        p.parent_project_id         as parent_project_id,
        p.created_at                as project_created_at,
        p.user_id                   as owner_user_id,
        p.manufacturer_id           as manufacturer_id,
        m.name                      as manufacturer_name,
        um.color                    as manufacturer_color,
        um.tag                      as manufacturer_tag,
        c.currency_rate             as currency_rate,
        c.shipping_rate             as shipping_rate,
        c.customs_rate              as customs_rate,
        c.profit_margin             as profit_margin,
        c.tax_rate                  as tax_rate
      from pricing_product_lines pl
      join pricing_projects p on p.id = pl.project_id
      join pricing_manufacturers m on m.id = p.manufacturer_id
      left join pricing_project_constants c on c.project_id = p.id
      left join pricing_user_manufacturers um
        on um.manufacturer_id = m.id
       and um.user_id = ${user.id}
       and um.deleted_at is null
      where p.deleted_at is null
        and pl.item_model ilike ${like}
        ${visibilityFragment}
        ${mfgFragment}
      limit ${limit}
    `) as Array<Record<string, unknown>>;

    const num = (v: unknown, fallback = 0): number => {
      const n = typeof v === "number" ? v : parseFloat(String(v));
      return Number.isFinite(n) ? n : fallback;
    };
    const numOrNull = (v: unknown): number | null => {
      if (v == null) return null;
      const n = typeof v === "number" ? v : parseFloat(String(v));
      return Number.isFinite(n) ? n : null;
    };

    const results = rows.map((r) => {
      // Fall back to the module defaults when a project predates the
      // constants snapshot, matching what the sheet renders.
      const constants: Constants = {
        currencyRate:
          r.currency_rate != null
            ? num(r.currency_rate)
            : DEFAULT_CONSTANTS.currencyRate,
        shippingRate:
          r.shipping_rate != null
            ? num(r.shipping_rate)
            : DEFAULT_CONSTANTS.shippingRate,
        customsRate:
          r.customs_rate != null
            ? num(r.customs_rate)
            : DEFAULT_CONSTANTS.customsRate,
        profitMargin:
          r.profit_margin != null
            ? num(r.profit_margin)
            : DEFAULT_CONSTANTS.profitMargin,
        taxRate:
          r.tax_rate != null ? num(r.tax_rate) : DEFAULT_CONSTANTS.taxRate,
      };

      const priceUsd = num(r.price_usd);
      const quantity = num(r.quantity, 1);
      const calc = calculateRow(
        {
          itemModel: String(r.item_model ?? ""),
          priceUsd,
          quantity,
          shippingOverride: numOrNull(r.shipping_override),
          customsOverride: numOrNull(r.customs_override),
          shippingRateOverride: numOrNull(r.shipping_rate_override),
          customsRateOverride: numOrNull(r.customs_rate_override),
          profitRateOverride: numOrNull(r.profit_rate_override),
        },
        constants,
      );

      return {
        lineId: Number(r.line_id),
        itemModel: String(r.item_model ?? ""),
        priceUsd,
        quantity,
        projectId: Number(r.project_id),
        projectName: String(r.project_name ?? ""),
        date: (r.project_date as string | null) ?? null,
        responsiblePerson: (r.responsible_person as string | null) ?? null,
        revisionNumber: r.revision_number != null ? Number(r.revision_number) : 1,
        parentProjectId:
          r.parent_project_id != null ? Number(r.parent_project_id) : null,
        createdAt: (r.project_created_at as string | null) ?? null,
        ownerUserId: r.owner_user_id != null ? Number(r.owner_user_id) : null,
        manufacturerId: Number(r.manufacturer_id),
        manufacturerName: String(r.manufacturer_name ?? ""),
        manufacturerColor: (r.manufacturer_color as string | null) ?? null,
        manufacturerTag: (r.manufacturer_tag as string | null) ?? null,
        // Per-unit JOD figures, plus quantity totals.
        currencyRate: constants.currencyRate,
        unitLandedCost: calc.landedCost,
        unitFinalPrice: calc.finalPrice,
        landedCostTotal: calc.landedCostTotal,
        finalPriceTotal: calc.finalPriceTotal,
      };
    });

    // Sort in JS so date (stored as free-text) and the computed cost
    // figures can share one ordering path. Unparseable / missing dates
    // sink to the bottom regardless of direction.
    const dateValue = (d: string | null): number => {
      if (!d) return NaN;
      const t = Date.parse(d);
      return Number.isFinite(t) ? t : NaN;
    };
    results.sort((a, b) => {
      switch (sort) {
        case "date_asc": {
          const av = dateValue(a.date);
          const bv = dateValue(b.date);
          if (Number.isNaN(av) && Number.isNaN(bv)) return 0;
          if (Number.isNaN(av)) return 1;
          if (Number.isNaN(bv)) return -1;
          return av - bv;
        }
        case "cost_desc":
          return b.landedCostTotal - a.landedCostTotal;
        case "cost_asc":
          return a.landedCostTotal - b.landedCostTotal;
        case "date_desc":
        default: {
          const av = dateValue(a.date);
          const bv = dateValue(b.date);
          if (Number.isNaN(av) && Number.isNaN(bv)) return 0;
          if (Number.isNaN(av)) return 1;
          if (Number.isNaN(bv)) return -1;
          return bv - av;
        }
      }
    });

    return NextResponse.json(results);
  } catch (err) {
    const msg = (err as Error).message;
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
