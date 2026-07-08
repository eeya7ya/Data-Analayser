export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireWriter } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { isPricingAdmin } from "@/lib/pricing/access";
import {
  DEFAULT_CONSTANTS,
  calculateRow,
  type Constants,
  type ProductInput,
} from "@/lib/pricing/calculations";

/**
 * Convert a pricing-sheet project into a fresh active quotation in the
 * host's quotation system.
 *
 * Maps cleanly onto the existing /api/quotations POST contract: we
 * build the body and dispatch internally so the host's REF generator,
 * folder defaulting and approval gating all kick in unchanged. The
 * generated quotation is then ready for the user to refine inside the
 * Designer at /quotation?id=<returned-id>.
 *
 * Line-item mapping:
 *   • brand        ← pricing manufacturer name
 *   • model        ← product_lines.item_model
 *   • quantity     ← product_lines.quantity
 *   • unit_price   ← calculated `preTaxPrice` per unit (JOD), so the
 *                    quotation's own tax_percent line shows tax cleanly
 *   • price_si     ← calculated `preTaxPrice` (used as the SI baseline
 *                    so price-category switches in the Designer recompute
 *                    sensibly)
 *   • description  ← USD source price + qty, for traceability
 *   • system       ← "Equipment" (the Designer groups by system on print)
 *
 * Body params (all optional):
 *   • projectName     — defaults to "<manufacturer> — <pricing project>"
 *   • folderId        — quotation folder; if omitted, host drops onto
 *                       Unfiled (active quotations) or the folder's
 *                       Default Project (handled by /api/quotations)
 *   • includeOptionalIntro — when true, append a 1-line note explaining
 *                            the quotation was generated from a pricing
 *                            sheet
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireWriter();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();

    const { id } = await params;
    const projectId = parseInt(id, 10);
    if (!Number.isFinite(projectId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const q = sql();
    const projectRows = (await q`
      select p.id, p.name, p.user_id, p.manufacturer_id,
             m.name as manufacturer_name
      from pricing_projects p
      join pricing_manufacturers m on m.id = p.manufacturer_id
      where p.id = ${projectId} and p.deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      name: string;
      user_id: number | null;
      manufacturer_id: number;
      manufacturer_name: string;
    }>;
    if (projectRows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const project = projectRows[0];
    if (!isPricingAdmin(user) && project.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      projectName?: string;
      folderId?: number | null;
      projectId?: number | null;
      includeOptionalIntro?: boolean;
    };

    const constantsRows = (await q`
      select currency_rate, shipping_rate, customs_rate,
             profit_margin, tax_rate
      from pricing_project_constants
      where project_id = ${projectId}
      limit 1
    `) as Array<{
      currency_rate: string;
      shipping_rate: string;
      customs_rate: string;
      profit_margin: string;
      tax_rate: string;
    }>;
    // Coerce defensively — a poisoned constants row (SQL numeric NaN) would
    // otherwise produce a quotation full of NaN prices. Fall back per-field.
    const numOr = (v: unknown, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const cRow = constantsRows[0];
    const constants: Constants = cRow
      ? {
          currencyRate: numOr(cRow.currency_rate, DEFAULT_CONSTANTS.currencyRate),
          shippingRate: numOr(cRow.shipping_rate, DEFAULT_CONSTANTS.shippingRate),
          customsRate: numOr(cRow.customs_rate, DEFAULT_CONSTANTS.customsRate),
          profitMargin: numOr(cRow.profit_margin, DEFAULT_CONSTANTS.profitMargin),
          taxRate: numOr(cRow.tax_rate, DEFAULT_CONSTANTS.taxRate),
        }
      : DEFAULT_CONSTANTS;

    const lineRows = (await q`
      select position, item_model, price_usd, quantity,
             shipping_override, customs_override,
             shipping_rate_override, customs_rate_override,
             profit_rate_override, description
      from pricing_product_lines
      where project_id = ${projectId}
      order by position asc
    `) as Array<{
      position: number;
      item_model: string;
      price_usd: string;
      quantity: number;
      shipping_override: string | null;
      customs_override: string | null;
      shipping_rate_override: string | null;
      customs_rate_override: string | null;
      profit_rate_override: string | null;
      description: string | null;
    }>;

    const calculated = lineRows
      .filter((l) => l.item_model.trim() || Number(l.price_usd) > 0)
      .map((l) => {
        const input: ProductInput = {
          itemModel: l.item_model,
          priceUsd: Number(l.price_usd),
          quantity: l.quantity,
          shippingOverride: l.shipping_override != null ? Number(l.shipping_override) : null,
          customsOverride: l.customs_override != null ? Number(l.customs_override) : null,
          shippingRateOverride:
            l.shipping_rate_override != null ? Number(l.shipping_rate_override) : null,
          customsRateOverride:
            l.customs_rate_override != null ? Number(l.customs_rate_override) : null,
          profitRateOverride:
            l.profit_rate_override != null ? Number(l.profit_rate_override) : null,
          description: l.description,
        };
        return { input, calc: calculateRow(input, constants) };
      });

    if (calculated.length === 0) {
      return NextResponse.json(
        { error: "Project has no priced product lines yet" },
        { status: 400 },
      );
    }

    // Build the host's QuotationItem[] payload. We use the pre-tax
    // per-unit price as unit_price and let the quotation's own
    // tax_percent surface the tax as a separate line — that way the
    // grand total still reflects landed-cost + profit + tax exactly,
    // and any future tax-rate change in the Designer cascades cleanly.
    const items = calculated.map(({ input, calc }, idx) => ({
      no: idx + 1,
      kind: "item" as const,
      system: "Equipment",
      brand: project.manufacturer_name,
      model: input.itemModel || "—",
      // Prefer the line's ready description (filled on the pricing sheet); fall
      // back to the traceability line when none was written.
      description:
        typeof input.description === "string" && input.description.trim()
          ? input.description.trim()
          : `Imported from pricing sheet · USD ${input.priceUsd} × ${input.quantity}`,
      quantity: input.quantity,
      unit_price: Number(calc.preTaxPrice.toFixed(3)),
      price_si: Number(calc.preTaxPrice.toFixed(3)),
      delivery: "",
    }));

    const taxPercent = Number((constants.taxRate * 100).toFixed(2));
    const subtotal = items.reduce(
      (acc, it) => acc + it.unit_price * it.quantity,
      0,
    );
    const tax = subtotal * (taxPercent / 100);
    const projectName =
      body.projectName?.trim() ||
      `${project.manufacturer_name} — ${project.name}`;

    // POST internally to /api/quotations so REF / folder / approval
    // logic runs through one canonical path.
    const origin = new URL(req.url).origin;
    const cookieHeader = req.headers.get("cookie") ?? "";
    // Always seed a clean, professional Project Scope Summary for a quotation
    // converted from a pricing sheet. A converted sheet drops every line into
    // one synthetic "Equipment" system, so a blank scope would auto-generate
    // "...covering Equipment..." on the printed offer. This default copy always
    // fires (the old "Quotation generated from pricing sheet …" placeholder is
    // gone); the user can still edit it freely in the Designer afterwards.
    const scopeSummary =
      `We sincerely appreciate the opportunity to collaborate with you on ` +
      `${project.name} and thank you for your continued trust in Magic ` +
      `Technology. The following proposal reflects the fully engineered scope ` +
      `of works and the associated investment, prepared to meet your ` +
      `requirements with the highest standards of quality and reliability.`;

    const upstream = await fetch(`${origin}/api/quotations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: cookieHeader,
      },
      body: JSON.stringify({
        mode: "active",
        project_name: projectName,
        site_name: "SITE",
        tax_percent: taxPercent,
        items,
        totals: {
          subtotal: Number(subtotal.toFixed(3)),
          tax: Number(tax.toFixed(3)),
          total: Number((subtotal + tax).toFixed(3)),
        },
        config: {
          pricingCategory: "manual",
          manualFactor: 1,
          // Unit prices above are PRE-TAX, so the Designer must open with
          // tax added on top ("Tax ON" + "Excl. Tax"). Without these flags
          // it defaults to its tax-inclusive entry state, mislabelling the
          // pre-tax prices as tax-included — and toggling the button to
          // correct it would divide every price by (1 + rate).
          includeTax: true,
          taxInclusive: true,
          // Prices are already tax-exclusive; block the Designer's one-time
          // legacy divide-by-(1+rate) migration for taxInclusive configs.
          taxPricesNormalized: true,
          scopeIntro: scopeSummary,
          origin: { pricingProjectId: projectId },
        },
        folder_id: body.folderId ?? null,
        project_id: body.projectId ?? null,
      }),
    });
    if (!upstream.ok) {
      const detail = await upstream.json().catch(() => ({}));
      return NextResponse.json(
        {
          error: "Quotation create failed",
          detail,
        },
        { status: upstream.status },
      );
    }
    const result = (await upstream.json()) as {
      quotation: { id: number; ref: string };
    };
    return NextResponse.json({
      quotationId: result.quotation.id,
      ref: result.quotation.ref,
      redirectTo: `/quotation?id=${result.quotation.id}`,
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
