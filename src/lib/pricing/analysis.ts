import {
  calculateRow,
  calculateTotals,
  type Constants,
  type ProductInput,
} from "./calculations";

/**
 * Quantitative analysis engine for a pricing sheet. Turns the raw rows +
 * constants into the metrics, cost structure, revenue concentration and a set
 * of plain-English commentary sentences shared by the on-screen charts and the
 * printed report — so the analysis reads the same everywhere.
 */
export interface LineContribution {
  name: string;
  revenue: number;
  landed: number;
  profit: number;
  sharePct: number; // of total revenue
  cumulativePct: number; // running total, sorted desc
}

export interface PricingAnalysis {
  lines: number;
  units: number;
  revenue: number;
  landedCost: number;
  profit: number;
  tax: number;
  preTax: number;
  jodBase: number;
  shipping: number;
  customs: number;

  marginPct: number; // profit / revenue
  markupPct: number; // profit / landed cost
  costRatioPct: number; // landed cost / revenue
  effTaxPct: number; // tax / pre-tax
  avgUnitRevenue: number;
  fx: number;

  /** Composition as % of revenue. */
  comp: {
    base: number;
    shipping: number;
    customs: number;
    profit: number;
    tax: number;
  };

  contributions: LineContribution[];
  topLine: LineContribution | null;
  linesFor80: number; // #lines whose cumulative revenue first reaches 80%
  top2Pct: number;
  concentration: "concentrated" | "balanced" | "even";
  marginBand: "thin" | "modest" | "healthy" | "strong";

  /** Ready-to-render commentary sentences. */
  insights: string[];
}

function jod(v: number) {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function pct(part: number, whole: number) {
  return whole > 0 ? (part / whole) * 100 : 0;
}

export function analyzePricing(
  rows: ProductInput[],
  constants: Constants,
): PricingAnalysis | null {
  const active = rows.filter((r) => r.priceUsd > 0 && r.itemModel);
  if (active.length === 0) return null;

  const calc = active.map((r) => ({ ...r, ...calculateRow(r, constants) }));
  const t = calculateTotals(calc);

  const revenue = t.finalPriceTotal;
  const units = active.reduce((s, r) => s + r.quantity, 0);

  const marginPct = pct(t.profitTotal, revenue);
  const markupPct = pct(t.profitTotal, t.landedCostTotal);
  const costRatioPct = pct(t.landedCostTotal, revenue);
  const effTaxPct = pct(t.taxTotal, t.preTaxPriceTotal);
  const avgUnitRevenue = units > 0 ? revenue / units : 0;

  const comp = {
    base: pct(t.jodPriceTotal, revenue),
    shipping: pct(t.shippingTotal, revenue),
    customs: pct(t.customsTotal, revenue),
    profit: pct(t.profitTotal, revenue),
    tax: pct(t.taxTotal, revenue),
  };

  // Revenue concentration (Pareto).
  const sorted = [...calc].sort((a, b) => b.finalPriceTotal - a.finalPriceTotal);
  let running = 0;
  const contributions: LineContribution[] = sorted.map((r) => {
    running += r.finalPriceTotal;
    return {
      name: r.itemModel,
      revenue: r.finalPriceTotal,
      landed: r.landedCostTotal,
      profit: r.profitTotal,
      sharePct: pct(r.finalPriceTotal, revenue),
      cumulativePct: pct(running, revenue),
    };
  });
  const topLine = contributions[0] ?? null;
  const linesFor80 =
    contributions.findIndex((c) => c.cumulativePct >= 80) + 1 ||
    contributions.length;
  const top2Pct = contributions
    .slice(0, 2)
    .reduce((s, c) => s + c.sharePct, 0);

  const concentration: PricingAnalysis["concentration"] =
    contributions.length >= 3 && linesFor80 <= Math.ceil(contributions.length * 0.34)
      ? "concentrated"
      : linesFor80 <= Math.ceil(contributions.length * 0.6)
        ? "balanced"
        : "even";

  const marginBand: PricingAnalysis["marginBand"] =
    marginPct < 10
      ? "thin"
      : marginPct < 20
        ? "modest"
        : marginPct < 35
          ? "healthy"
          : "strong";

  const cur = "JOD";
  const insights: string[] = [];

  // 1 — Profitability.
  insights.push(
    `Net margin is ${marginPct.toFixed(1)}% (${marginBand}): every 1.000 ${cur} ` +
      `of revenue returns ${(marginPct / 100).toFixed(3)} ${cur} of gross profit. ` +
      `Applied markup on landed cost is ${markupPct.toFixed(1)}% — the two differ ` +
      `because tax and cost sit between them.`,
  );

  // 2 — Cost structure.
  insights.push(
    `Landed cost absorbs ${costRatioPct.toFixed(1)}% of revenue, of which the ` +
      `imported goods (${cur} base) are the single largest driver at ` +
      `${comp.base.toFixed(1)}%; shipping adds ${comp.shipping.toFixed(1)}% and ` +
      `customs ${comp.customs.toFixed(1)}%.`,
  );

  // 3 — Revenue concentration.
  if (contributions.length >= 2 && topLine) {
    if (concentration === "concentrated") {
      insights.push(
        `Revenue is concentrated: the top ${linesFor80} of ${contributions.length} ` +
          `lines make up ~80% of the total, led by "${topLine.name}" at ` +
          `${topLine.sharePct.toFixed(1)}%. Pricing or negotiation on these few ` +
          `lines moves the whole quotation.`,
      );
    } else {
      insights.push(
        `Revenue is spread ${concentration === "even" ? "evenly" : "fairly evenly"} ` +
          `across ${contributions.length} lines (top line "${topLine.name}" is ` +
          `${topLine.sharePct.toFixed(1)}%), so no single item dominates the offer.`,
      );
    }
  }

  // 4 — Tax drag.
  insights.push(
    `Tax adds ${jod(t.taxTotal)} ${cur} (${effTaxPct.toFixed(1)}% on the pre-tax ` +
      `price, ${comp.tax.toFixed(1)}% of final revenue) — it is a pass-through, ` +
      `not margin.`,
  );

  // 5 — Sensitivity levers.
  const profitPerPoint = t.landedCostTotal / 100; // 1pt of margin-on-cost
  const fxPerPoint = t.landedCostTotal / 100; // ≈ landed cost moves ~1% per 1% FX
  insights.push(
    `Sensitivity: +1 pt of profit margin adds ~${jod(profitPerPoint)} ${cur} of ` +
      `gross profit; a 1% ${cur === "JOD" ? "USD→JOD" : "FX"} move shifts landed ` +
      `cost by ~${jod(fxPerPoint)} ${cur} at the current ${constants.currencyRate.toFixed(4)} rate.`,
  );

  return {
    lines: contributions.length,
    units,
    revenue,
    landedCost: t.landedCostTotal,
    profit: t.profitTotal,
    tax: t.taxTotal,
    preTax: t.preTaxPriceTotal,
    jodBase: t.jodPriceTotal,
    shipping: t.shippingTotal,
    customs: t.customsTotal,
    marginPct,
    markupPct,
    costRatioPct,
    effTaxPct,
    avgUnitRevenue,
    fx: constants.currencyRate,
    comp,
    contributions,
    topLine,
    linesFor80,
    top2Pct,
    concentration,
    marginBand,
    insights,
  };
}
