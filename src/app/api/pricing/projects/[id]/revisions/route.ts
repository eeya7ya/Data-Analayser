export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, requireWriter } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { isPricingAdmin } from "@/lib/pricing/access";

type Ctx = { params: Promise<{ id: string }> };

interface SourceRow {
  id: number;
  name: string;
  date: string | null;
  responsible_person: string | null;
  manufacturer_id: number;
  user_id: number | null;
  parent_project_id: number | null;
  revision_number: number;
}

/**
 * Save-as-Revision. The cloned row is anchored to the lineage's root
 * project via parent_project_id and assigned the lineage's
 * next-highest revision number, so v1 → v2 → v3 stays unambiguous
 * regardless of which sibling the user branched from.
 *
 * The client may send an in-memory snapshot (`name`, `constants`,
 * `productLines`) to capture unsaved edits — otherwise the new revision
 * mirrors the source row's persisted state.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireWriter();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();

    const { id } = await params;
    const sourceId = parseInt(id, 10);
    if (!Number.isFinite(sourceId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const q = sql();
    const sourceRows = (await q`
      select id, name, date, responsible_person, manufacturer_id,
             user_id, parent_project_id, revision_number
      from pricing_projects
      where id = ${sourceId} and deleted_at is null
      limit 1
    `) as SourceRow[];
    if (sourceRows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const source = sourceRows[0];
    if (!isPricingAdmin(user) && source.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      date?: string | null;
      responsiblePerson?: string;
      constants?: {
        currencyRate?: number | string;
        shippingRate?: number | string;
        customsRate?: number | string;
        profitMargin?: number | string;
        taxRate?: number | string;
        targetCurrency?: string;
        sourceCurrency?: string;
      };
      productLines?: Array<{
        itemModel?: string;
        priceUsd?: number | string;
        quantity?: number;
        shippingOverride?: number | string | null;
        customsOverride?: number | string | null;
        shippingRateOverride?: number | string | null;
        customsRateOverride?: number | string | null;
        profitRateOverride?: number | string | null;
      }>;
    };

    const rootId = source.parent_project_id ?? source.id;
    const lineage = (await q`
      select revision_number
      from pricing_projects
      where id = ${rootId} or parent_project_id = ${rootId}
    `) as Array<{ revision_number: number }>;
    const nextRevision =
      lineage.reduce(
        (acc, r) =>
          Number(r.revision_number) > acc ? Number(r.revision_number) : acc,
        0,
      ) + 1;

    const customName = body.name?.trim();
    const baseName = customName ?? source.name;
    const newName = customName
      ? baseName
      : /\bv\d+$/.test(baseName.trim())
        ? baseName
        : `${baseName} — v${nextRevision}`;

    const createdRows = (await q`
      insert into pricing_projects (
        name, date, responsible_person, manufacturer_id,
        user_id, parent_project_id, revision_number
      ) values (
        ${newName},
        ${body.date !== undefined ? body.date ?? null : source.date},
        ${body.responsiblePerson?.trim() ?? source.responsible_person},
        ${source.manufacturer_id},
        ${source.user_id ?? user.id},
        ${rootId},
        ${nextRevision}
      )
      returning id, name, date, responsible_person, manufacturer_id,
                user_id, parent_project_id, revision_number,
                created_at, deleted_at
    `) as Array<Record<string, unknown>>;
    const created = createdRows[0];
    const createdId = created.id as number;

    // Constants — clone the existing row unless the client overrode any.
    const sourceConstants = (await q`
      select currency_rate, shipping_rate, customs_rate, profit_margin,
             tax_rate, target_currency, source_currency
      from pricing_project_constants
      where project_id = ${source.id}
      limit 1
    `) as Array<Record<string, string>>;
    const sc = sourceConstants[0];
    const override = body.constants;
    await q`
      insert into pricing_project_constants (
        project_id, currency_rate, shipping_rate, customs_rate,
        profit_margin, tax_rate, target_currency, source_currency
      ) values (
        ${createdId},
        ${String(override?.currencyRate ?? sc?.currency_rate ?? "0.710000")},
        ${String(override?.shippingRate ?? sc?.shipping_rate ?? "0.150000")},
        ${String(override?.customsRate  ?? sc?.customs_rate  ?? "0.120000")},
        ${String(override?.profitMargin ?? sc?.profit_margin ?? "0.250000")},
        ${String(override?.taxRate      ?? sc?.tax_rate      ?? "0.160000")},
        ${override?.targetCurrency ?? sc?.target_currency ?? "JOD"},
        ${override?.sourceCurrency ?? sc?.source_currency ?? "USD"}
      )
    `;

    // Product lines — prefer the in-memory snapshot if supplied so a
    // "Save as Revision" click captures the user's unsaved edits.
    const overrideLines = Array.isArray(body.productLines)
      ? body.productLines
      : null;
    if (overrideLines && overrideLines.length > 0) {
      const rows = overrideLines.map((l, idx) => ({
        project_id: createdId,
        position: idx + 1,
        item_model: l.itemModel ?? "",
        price_usd: String(l.priceUsd ?? 0),
        quantity: l.quantity ?? 1,
        shipping_override:
          l.shippingOverride != null ? String(l.shippingOverride) : null,
        customs_override:
          l.customsOverride != null ? String(l.customsOverride) : null,
        shipping_rate_override:
          l.shippingRateOverride != null
            ? String(l.shippingRateOverride)
            : null,
        customs_rate_override:
          l.customsRateOverride != null
            ? String(l.customsRateOverride)
            : null,
        profit_rate_override:
          l.profitRateOverride != null
            ? String(l.profitRateOverride)
            : null,
      }));
      await q`insert into pricing_product_lines ${q(rows)}`;
    } else {
      // copy from persisted source lines
      await q`
        insert into pricing_product_lines (
          project_id, position, item_model, price_usd, quantity,
          shipping_override, customs_override,
          shipping_rate_override, customs_rate_override, profit_rate_override
        )
        select ${createdId}, position, item_model, price_usd, quantity,
               shipping_override, customs_override,
               shipping_rate_override, customs_rate_override, profit_rate_override
        from pricing_product_lines
        where project_id = ${source.id}
        order by position asc
      `;
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/** Returns the full lineage (root + every descendant) for the revision picker. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const { id } = await params;
    const sourceId = parseInt(id, 10);
    if (!Number.isFinite(sourceId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const q = sql();
    const sourceRows = (await q`
      select id, user_id, parent_project_id
      from pricing_projects
      where id = ${sourceId}
      limit 1
    `) as Array<{
      id: number;
      user_id: number | null;
      parent_project_id: number | null;
    }>;
    if (sourceRows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const source = sourceRows[0];
    if (!isPricingAdmin(user) && source.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const rootId = source.parent_project_id ?? source.id;
    const lineage = (await q`
      select id, name, date, responsible_person, revision_number,
             parent_project_id, created_at
      from pricing_projects
      where deleted_at is null
        and (id = ${rootId} or parent_project_id = ${rootId})
      order by revision_number asc
    `) as Array<Record<string, unknown>>;
    return NextResponse.json({ rootProjectId: rootId, revisions: lineage });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
