import type { QuotationItem } from "@/components/QuotationPreview";

/**
 * Columns whose values are read through the merge chain. Must stay in
 * sync with MERGEABLE_COLUMNS in QuotationPreview.tsx — the cell UI
 * there renders them with rowSpan, so any calculation that reads one of
 * these fields on a merged row must walk back to the anchor to stay
 * consistent with what the user sees.
 */
const MERGE_RESOLVED_COLUMNS = [
  "brand",
  "model",
  "description",
  "delivery",
  "unit_price",
] as const;

type MergeResolvedCol = (typeof MERGE_RESOLVED_COLUMNS)[number];

/**
 * Returns the effective value of a mergeable column for a row inside a
 * single system group, by walking back through `merge_up` flags until a
 * non-merged anchor row is found. Scoped to one group because merge
 * chains never cross system boundaries — `computeMergePlan` in
 * QuotationPreview.tsx only fires within a group too.
 */
export function effectiveMergedValue<C extends MergeResolvedCol>(
  rows: QuotationItem[],
  rowIdx: number,
  col: C,
): QuotationItem[C] {
  let i = rowIdx;
  while (i > 0 && rows[i].merge_up?.[col]) i--;
  return rows[i][col];
}

/** Group items by their `system` field, preserving first-seen order. */
function groupBySystem(items: QuotationItem[]): QuotationItem[][] {
  const order: string[] = [];
  const map = new Map<string, QuotationItem[]>();
  for (const item of items) {
    const key = item.system || item.brand || "General";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(item);
  }
  return order.map((k) => map.get(k)!);
}

/**
 * Total price for a single row, using the merge-resolved unit price.
 * Rows flagged with `optional` are presented to the client as add-ons
 * whose price is visible but not part of the offer, so they contribute
 * 0 here and drop out of every downstream total.
 */
export function effectiveRowTotal(rows: QuotationItem[], rowIdx: number): number {
  if (rows[rowIdx].optional) return 0;
  const qty = Number(rows[rowIdx].quantity) || 0;
  const price = Number(effectiveMergedValue(rows, rowIdx, "unit_price")) || 0;
  return qty * price;
}

/**
 * Returns the divisor to apply when entered prices already include tax.
 * E.g. taxDivisor(16, true) → 1.16;  taxDivisor(16, false) → 1.
 */
export function taxDivisor(taxPercent: number, taxInclusive: boolean): number {
  if (!taxInclusive) return 1;
  const rate = (Number(taxPercent) || 0) / 100;
  return rate > 0 ? 1 + rate : 1;
}

/**
 * Computes subtotal / tax / total the same way the preview renders
 * them: group items by system, resolve the effective unit price for
 * every row inside each group, and sum. Keeps the saved totals and the
 * on-screen numbers in lockstep, even when the user merges unit-price
 * cells.
 *
 * Unit prices are stored in their final form — the Designer transforms
 * them at the moment the user toggles the Excl./Incl. Tax button — so
 * this routine always adds tax on top of the raw subtotal. The legacy
 * back-calculation branch (when the flag was a display overlay) has
 * been removed; `_taxInclusive` is kept in the signature for call-site
 * compatibility only.
 */
export function computeQuotationTotals(
  items: QuotationItem[],
  taxPercent: number,
  _taxInclusive: boolean = false,
): { subtotal: number; tax: number; total: number } {
  let subtotal = 0;
  for (const group of groupBySystem(items)) {
    for (let i = 0; i < group.length; i++) {
      subtotal += effectiveRowTotal(group, i);
    }
  }
  const rate = (Number(taxPercent) || 0) / 100;
  const tax = subtotal * rate;
  return { subtotal, tax, total: subtotal + tax };
}
