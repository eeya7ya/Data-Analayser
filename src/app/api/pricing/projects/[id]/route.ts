export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sql, ensureSchema, rawBinder } from "@/lib/db";
import { requireUser, requireWriter } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { isPricingAdmin } from "@/lib/pricing/access";

type Ctx = { params: Promise<{ id: string }> };

interface ProjectRow {
  id: number;
  name: string;
  date: string | null;
  responsible_person: string | null;
  manufacturer_id: number;
  user_id: number | null;
  parent_project_id: number | null;
  revision_number: number;
  created_at: string;
  deleted_at: string | null;
  exec_status: string | null;
}

async function loadProjectIfAllowed(
  userId: number,
  isAdmin: boolean,
  projectId: number,
): Promise<ProjectRow | { status: number; error: string }> {
  const q = sql();
  const rows = (await q`
    select id, name, date, responsible_person, manufacturer_id,
           user_id, parent_project_id, revision_number,
           created_at, deleted_at, exec_status
    from pricing_projects
    where id = ${projectId} and deleted_at is null
    limit 1
  `) as ProjectRow[];
  if (rows.length === 0) return { status: 404, error: "Not found" };
  const row = rows[0];
  if (!isAdmin && row.user_id !== userId) {
    return { status: 403, error: "Forbidden" };
  }
  return row;
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const { id } = await params;
    const projectId = parseInt(id, 10);

    const result = await loadProjectIfAllowed(
      user.id,
      isPricingAdmin(user),
      projectId,
    );
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const q = sql();
    const constantsRows = (await q`
      select currency_rate, shipping_rate, customs_rate, profit_margin,
             tax_rate, target_currency, source_currency
      from pricing_project_constants
      where project_id = ${projectId}
      limit 1
    `) as Array<{
      currency_rate: string;
      shipping_rate: string;
      customs_rate: string;
      profit_margin: string;
      tax_rate: string;
      target_currency: string;
      source_currency: string;
    }>;
    const lines = (await q`
      select id, position, item_model, price_usd, quantity,
             shipping_override, customs_override,
             shipping_rate_override, customs_rate_override,
             profit_rate_override
      from pricing_product_lines
      where project_id = ${projectId}
      order by position asc
    `) as Array<{
      id: number;
      position: number;
      item_model: string;
      price_usd: string;
      quantity: number;
      shipping_override: string | null;
      customs_override: string | null;
      shipping_rate_override: string | null;
      customs_rate_override: string | null;
      profit_rate_override: string | null;
    }>;

    return NextResponse.json({
      project: result,
      // Map snake_case DB columns to the camelCase shape the pricing sheet
      // reads. Without this the client gets `currency_rate` but looks for
      // `currencyRate` (→ undefined → NaN), and `item_model` / `price_usd`
      // come back blank — the project appeared to "lose" everything but the
      // quantity (which happens to share the same key) on every reload.
      constants: constantsRows[0]
        ? {
            currencyRate: constantsRows[0].currency_rate,
            shippingRate: constantsRows[0].shipping_rate,
            customsRate: constantsRows[0].customs_rate,
            profitMargin: constantsRows[0].profit_margin,
            taxRate: constantsRows[0].tax_rate,
            targetCurrency: constantsRows[0].target_currency,
            sourceCurrency: constantsRows[0].source_currency,
          }
        : null,
      productLines: lines.map((l) => ({
        id: l.id,
        position: l.position,
        itemModel: l.item_model,
        priceUsd: l.price_usd,
        quantity: l.quantity,
        shippingOverride: l.shipping_override,
        customsOverride: l.customs_override,
        shippingRateOverride: l.shipping_rate_override,
        customsRateOverride: l.customs_rate_override,
        profitRateOverride: l.profit_rate_override,
      })),
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

interface ProductLineInput {
  itemModel?: string;
  priceUsd?: number | string;
  quantity?: number;
  shippingOverride?: number | string | null;
  customsOverride?: number | string | null;
  shippingRateOverride?: number | string | null;
  customsRateOverride?: number | string | null;
  profitRateOverride?: number | string | null;
}

interface PutBody {
  name?: string;
  date?: string | null;
  responsiblePerson?: string | null;
  constants?: {
    currencyRate: number | string;
    shippingRate: number | string;
    customsRate: number | string;
    profitMargin: number | string;
    taxRate: number | string;
    targetCurrency?: string;
    sourceCurrency?: string;
  };
  productLines?: ProductLineInput[];
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const user = await requireWriter();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const { id } = await params;
    const projectId = parseInt(id, 10);
    const result = await loadProjectIfAllowed(
      user.id,
      isPricingAdmin(user),
      projectId,
    );
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const body = (await req.json().catch(() => ({}))) as PutBody;
    const q = sql();

    // Header fields — only update when actually provided so a partial
    // edit (e.g. just the constants) doesn't blank out the name. Each field
    // is its own plain template update: the postgres.js `sql(obj, ...keys)`
    // dynamic-SET helper is NOT supported by the D1 client (it can't compose
    // query fragments), which is what made every Save on D1 fail with
    // `near "?": syntax error`.
    if (body.name !== undefined) {
      await q`update pricing_projects set name = ${body.name.trim()} where id = ${projectId}`;
    }
    if (body.date !== undefined) {
      await q`update pricing_projects set date = ${body.date ?? null} where id = ${projectId}`;
    }
    if (body.responsiblePerson !== undefined) {
      await q`update pricing_projects set responsible_person = ${body.responsiblePerson?.trim() || null} where id = ${projectId}`;
    }

    // Coerce any value to a finite-number string, or a fallback. Critical
    // for numeric columns: Postgres `numeric` accepts the special value
    // 'NaN', so a stray NaN/undefined from the client would silently poison
    // the row and cascade NaN through every calculation on reload.
    const numStr = (v: unknown, fallback: number): string => {
      const n = Number(v);
      return Number.isFinite(n) ? String(n) : String(fallback);
    };
    const numStrOrNull = (v: unknown): string | null => {
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? String(n) : null;
    };

    if (body.constants !== undefined) {
      await q`
        update pricing_project_constants
        set currency_rate   = ${numStr(body.constants.currencyRate, 0.71)},
            shipping_rate   = ${numStr(body.constants.shippingRate, 0.15)},
            customs_rate    = ${numStr(body.constants.customsRate, 0.12)},
            profit_margin   = ${numStr(body.constants.profitMargin, 0.25)},
            tax_rate        = ${numStr(body.constants.taxRate, 0.16)},
            target_currency = ${body.constants.targetCurrency ?? "JOD"},
            source_currency = ${body.constants.sourceCurrency ?? "USD"}
        where project_id = ${projectId}
      `;
    }

    if (body.productLines !== undefined) {
      // Replace strategy mirrors the pricing-sheet app — easier to reason
      // about than diffing positions, and lines are always small (<200).
      await q`
        delete from pricing_product_lines where project_id = ${projectId}
      `;
      if (body.productLines.length > 0) {
        // One multi-row INSERT built with backend-aware placeholders. The
        // postgres.js `sql(rows)` bulk-insert helper is NOT supported by the
        // D1 client, so we assemble the VALUES tuples ourselves via rawBinder.
        const { P, params } = rawBinder();
        const tuples = body.productLines
          .map((line, idx) => {
            const cells = [
              P(projectId),
              P(idx + 1),
              P(line.itemModel ?? ""),
              P(numStr(line.priceUsd, 0)),
              P(Number.isFinite(Number(line.quantity)) ? Number(line.quantity) : 1),
              P(numStrOrNull(line.shippingOverride)),
              P(numStrOrNull(line.customsOverride)),
              P(numStrOrNull(line.shippingRateOverride)),
              P(numStrOrNull(line.customsRateOverride)),
              P(numStrOrNull(line.profitRateOverride)),
            ];
            return `(${cells.join(", ")})`;
          })
          .join(", ");
        await q.unsafe(
          `insert into pricing_product_lines
             (project_id, position, item_model, price_usd, quantity,
              shipping_override, customs_override,
              shipping_rate_override, customs_rate_override, profit_rate_override)
           values ${tuples}`,
          params,
        );
      }
    }

    const freshLines = (await q`
      select id, position, item_model, price_usd, quantity,
             shipping_override, customs_override,
             shipping_rate_override, customs_rate_override,
             profit_rate_override
      from pricing_product_lines
      where project_id = ${projectId}
      order by position asc
    `) as Array<Record<string, unknown>>;

    return NextResponse.json({ success: true, productLines: freshLines });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireWriter();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const { id } = await params;
    const projectId = parseInt(id, 10);
    const result = await loadProjectIfAllowed(
      user.id,
      isPricingAdmin(user),
      projectId,
    );
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const q = sql();
    await q`
      update pricing_projects
      set deleted_at = now()
      where id = ${projectId}
    `;
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
