import type { QuotationItem } from "@/components/QuotationPreview";
import { isSectionRow } from "@/components/QuotationPreview";

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
  // Walk back through merge_up flags, but stop at section rows — they
  // visually break the table into sub-sections, so a numeric/text cell
  // must never resolve to an anchor on the far side of a section banner.
  while (i > 0 && rows[i].merge_up?.[col] && !isSectionRow(rows[i - 1])) i--;
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
  if (isSectionRow(rows[rowIdx])) return 0;
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
 * A discount applied to the subtotal *before* tax. The user enters either
 * a percentage of the subtotal (which tracks the subtotal as items change)
 * or a fixed JOD amount that overrides the percentage. `mode` decides which
 * of the two is authoritative — both values are kept so toggling the mode
 * in the Designer is lossless.
 */
export interface QuotationDiscount {
  mode: "percent" | "amount";
  percent: number;
  amount: number;
}

/**
 * Resolves a discount spec to an actual JOD figure against a given
 * subtotal. Clamped to [0, subtotal] so a discount can never push the net
 * below zero (e.g. a stray 150% or an amount larger than the order).
 */
export function resolveDiscountValue(
  subtotal: number,
  discount?: QuotationDiscount | null,
): number {
  if (!discount) return 0;
  const raw =
    discount.mode === "amount"
      ? Number(discount.amount) || 0
      : subtotal * ((Number(discount.percent) || 0) / 100);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, subtotal);
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
  discount?: QuotationDiscount | null,
): {
  subtotal: number;
  discount: number;
  net: number;
  tax: number;
  total: number;
} {
  let subtotal = 0;
  for (const group of groupBySystem(items)) {
    for (let i = 0; i < group.length; i++) {
      subtotal += effectiveRowTotal(group, i);
    }
  }
  // Discount is applied to the subtotal before tax, so tax is charged on
  // the discounted net amount.
  const discountValue = resolveDiscountValue(subtotal, discount);
  const net = subtotal - discountValue;
  const rate = (Number(taxPercent) || 0) / 100;
  const tax = net * rate;
  return { subtotal, discount: discountValue, net, tax, total: net + tax };
}
