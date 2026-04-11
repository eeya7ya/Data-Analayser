"use client";

import React, { useRef } from "react";
import {
  computeQuotationTotals,
  effectiveMergedValue,
  taxDivisor,
} from "@/lib/quotationTotals";

export interface QuotationExtraColumn {
  /** Stable identifier used to key `QuotationItem.extra`. */
  id: string;
  /** User-facing header label. */
  label: string;
}

export interface QuotationItem {
  no: number;
  /** System / vendor-category name used to group items onto separate pages. */
  system: string;
  brand: string;
  model: string;
  description: string;
  quantity: number;
  unit_price: number;
  delivery: string;
  picture_hint?: string;
  /** Manually-inserted image (data URL or external URL). */
  picture_url?: string;
  /** Per-row values for user-added manual columns, keyed by column id. */
  extra?: Record<string, string>;
  /**
   * Per-column "merge with previous row" flags. When true for a column, the
   * cell is visually merged up into the nearest anchor row's cell (rendered
   * via rowSpan). Supported keys: brand, model, description, delivery,
   * unit_price, total_price, quantity, and `extra:<columnId>`.
   */
  merge_up?: Record<string, boolean>;
  /**
   * Per-column "merge with left neighbour" flags. Currently supported on
   * the contiguous text columns — brand, model, description — so users
   * can collapse a product's text cells into a single wide cell (rendered
   * via colSpan). Non-contiguous columns or numeric columns are never
   * merged horizontally so totals math stays sound.
   */
  merge_left?: Record<string, boolean>;
  /**
   * Original System Installer price from the product database. Stored so
   * that switching between pricing categories (SI / DPP / End-user) can
   * always recompute from the canonical base price.
   */
  price_si?: number;
}

export interface QuotationHeader {
  ref: string;
  date?: string;
  project_name: string;
  client_name?: string;
  client_email?: string;
  client_phone?: string;
  sales_engineer?: string;
  prepared_by?: string;
  sales_phone?: string;
  /**
   * Dedicated design / presales engineer — shown on the Terms page and
   * remembered across quotations via a localStorage preference. Falls back
   * to `sales_engineer` when not set, for backwards compatibility with
   * quotations saved before this field existed.
   */
  design_engineer?: string;
  site_name: string;
  tax_percent: number;
  /** User-added manual columns shown in every system table. */
  extra_columns?: QuotationExtraColumn[];
  /** Optional custom scope intro that appears above the Final Totals table. */
  scope_intro?: string;
}

interface Props {
  header: QuotationHeader;
  items: QuotationItem[];
  setItems?: (items: QuotationItem[]) => void;
  setHeader?: (patch: Partial<QuotationHeader>) => void;
  editable?: boolean;
  logoUrl?: string;
  showPictures?: boolean;
  terms?: string[];
  setTerms?: (terms: string[]) => void;
  /** When false, tax is excluded from the total cost. Defaults to true. */
  includeTax?: boolean;
  /** When true, entered prices already contain tax — back-calculate base. */
  taxInclusive?: boolean;
}

function money(n: number): string {
  return `JOD ${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function renumber(items: QuotationItem[]): QuotationItem[] {
  return items.map((it, i) => ({ ...it, no: i + 1 }));
}

/** Group items by their `system` field preserving first-seen order. */
function groupBySystem(items: QuotationItem[]): Array<{
  system: string;
  rows: Array<{ item: QuotationItem; globalIndex: number }>;
}> {
  const order: string[] = [];
  const map = new Map<
    string,
    Array<{ item: QuotationItem; globalIndex: number }>
  >();
  items.forEach((item, globalIndex) => {
    const key = item.system || item.brand || "General";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push({ item, globalIndex });
  });
  return order.map((system) => ({ system, rows: map.get(system)! }));
}

export default function QuotationPreview({
  header,
  items,
  setItems,
  setHeader,
  editable = false,
  logoUrl,
  showPictures = false,
  terms = [],
  setTerms,
  includeTax = true,
  taxInclusive = false,
}: Props) {
  // Resolve merged cells when summing so the Final Totals page matches
  // the per-group subtotals (and what the user visually sees in each
  // merged unit-price cell).
  const effectiveTaxPercent = includeTax ? (header.tax_percent || 0) : 0;
  const divisor = taxDivisor(header.tax_percent, taxInclusive);
  const { subtotal, tax, total } = computeQuotationTotals(
    items,
    effectiveTaxPercent,
    taxInclusive,
  );

  function update(i: number, patch: Partial<QuotationItem>) {
    if (!setItems) return;
    const next = items.slice();
    next[i] = { ...next[i], ...patch };
    setItems(next);
  }

  function addRowToSystem(system: string) {
    if (!setItems) return;
    setItems(
      renumber([
        ...items,
        {
          no: items.length + 1,
          system,
          brand: "",
          model: "",
          // Seed with a hint so every row — even manually-added blanks —
          // carries a clear description by default.
          description: `New ${system} item — please add a short description.`,
          quantity: 1,
          unit_price: 0,
          delivery: "TBD",
          extra: {},
        },
      ]),
    );
  }

  /**
   * Prompts for a page (system) name and adds an empty row to it.
   * Used from the empty-state so the user can start typing without first
   * having to go through the catalog or the AI designer.
   */
  function addManualItem() {
    if (!setItems) return;
    const existingPages = Array.from(
      new Set(items.map((it) => it.system).filter(Boolean)),
    );
    const suggestion = existingPages[0] || "General";
    const page = window.prompt(
      existingPages.length > 0
        ? `Add a new item to which page?\nExisting pages: ${existingPages.join(", ")}`
        : "Name the first page of this quotation (e.g. CCTV, Sound System)",
      suggestion,
    );
    if (!page || !page.trim()) return;
    addRowToSystem(page.trim());
  }

  function removeRow(i: number) {
    if (!setItems) return;
    setItems(renumber(items.filter((_, idx) => idx !== i)));
  }

  // Toggles the `merge_up` flag for a specific column on a specific row.
  // Pairs with SystemTable's `computeMergePlan` to render rowSpan correctly.
  // On merge (not unmerge) we also copy the anchor row's value into the
  // merged row's own data so unit-price equations stay consistent with
  // what the user visually sees in the rowSpan cell.
  function toggleMerge(globalIndex: number, col: MergeCol) {
    if (!setItems) return;
    const next = items.slice();
    const cur = next[globalIndex];
    if (!cur) return;
    const merge_up = { ...(cur.merge_up || {}) };
    if (merge_up[col]) {
      delete merge_up[col];
      next[globalIndex] = { ...cur, merge_up };
      setItems(next);
      return;
    }
    merge_up[col] = true;

    // Walk back through rows in the same system group to find the
    // anchor row's effective value for this column, then copy it over.
    const curKey = cur.system || cur.brand || "General";
    const groupRows: QuotationItem[] = [];
    const groupIndexForGlobal = new Map<number, number>();
    for (let i = 0; i < next.length; i++) {
      const it = next[i];
      const key = it.system || it.brand || "General";
      if (key !== curKey) continue;
      groupIndexForGlobal.set(i, groupRows.length);
      groupRows.push(it);
    }
    const localIdx = groupIndexForGlobal.get(globalIndex) ?? -1;
    if (localIdx > 0) {
      const anchorValue = effectiveMergedValue(groupRows, localIdx - 1, col);
      next[globalIndex] = {
        ...cur,
        [col]: anchorValue,
        merge_up,
      } as QuotationItem;
    } else {
      next[globalIndex] = { ...cur, merge_up };
    }
    setItems(next);
  }

  // Toggles the `merge_left` flag for a specific column on a specific row.
  // Pairs with SystemTable's `computeHRowPlan` to render colSpan correctly.
  // Horizontal merging is scoped to the contiguous text columns (brand,
  // model, description) so numeric totals never read from a collapsed cell.
  function toggleMergeLeft(globalIndex: number, col: HMergeCol) {
    if (!setItems) return;
    const next = items.slice();
    const cur = next[globalIndex];
    if (!cur) return;
    const merge_left = { ...(cur.merge_left || {}) };
    if (merge_left[col]) {
      delete merge_left[col];
    } else {
      merge_left[col] = true;
    }
    next[globalIndex] = { ...cur, merge_left };
    setItems(next);
  }

  function renameSystem(oldName: string, newName: string) {
    if (!setItems || !newName.trim() || newName === oldName) return;
    setItems(
      items.map((it) =>
        (it.system || it.brand || "General") === oldName
          ? { ...it, system: newName.trim() }
          : it,
      ),
    );
  }

  // ── Manual (user-added) columns ─────────────────────────────────────────
  const extraColumns: QuotationExtraColumn[] = header.extra_columns || [];

  function addExtraColumn() {
    if (!setHeader) return;
    const label = window.prompt(
      "Column header (e.g. Part No., Warranty, Location)",
      "",
    );
    if (!label || !label.trim()) return;
    const id = `c_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const next = [...extraColumns, { id, label: label.trim() }];
    setHeader({ extra_columns: next });
  }

  function renameExtraColumn(id: string, label: string) {
    if (!setHeader) return;
    const next = extraColumns.map((c) => (c.id === id ? { ...c, label } : c));
    setHeader({ extra_columns: next });
  }

  function removeExtraColumn(id: string) {
    if (!setHeader || !setItems) return;
    setHeader({ extra_columns: extraColumns.filter((c) => c.id !== id) });
    // Strip the removed column's value from every row so the JSON stays clean.
    setItems(
      items.map((it) => {
        if (!it.extra || !(id in it.extra)) return it;
        const nextExtra = { ...it.extra };
        delete nextExtra[id];
        return { ...it, extra: nextExtra };
      }),
    );
  }

  const groups = groupBySystem(items);
  // Number of printed pages = one per system group + one totals page.
  // When there are no items, just render a single empty page.
  const systemPages = groups.length > 0 ? groups : [];

  return (
    <div className="quotation-doc">
      {/* Fixed front matter — printed in order: cover, then about us. Both
       * are only visible in the print output (hidden on screen via CSS). */}
      <StaticSheet src="/quote-page-1.jpg" alt="Magic Tech cover page" />
      <StaticSheet src="/quote-page-2.jpg" alt="Magic Tech about us page" />

      {systemPages.length === 0 && (
        <QuotationPage
          header={header}
          setHeader={setHeader}
          editable={editable}
          logoUrl={logoUrl}
          isLast={!editable}
        >
          <p className="py-6 text-center text-magic-ink/50 text-xs">
            No items yet. Add products from the Catalogue, use the AI Designer,
            or start from scratch with the buttons below.
          </p>
          {editable && (
            <div className="no-print flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={addManualItem}
                className="rounded-md bg-magic-red text-white px-3 py-1.5 text-[11px] font-semibold hover:bg-red-700"
                title="Create a new page and add a blank row you can fill in by hand"
              >
                + Add manual item
              </button>
              <button
                onClick={addExtraColumn}
                className="rounded-md border border-magic-border px-3 py-1.5 text-[11px] hover:bg-magic-soft"
                title="Add a manual column that will show up in every table"
              >
                + Add manual column
              </button>
              {extraColumns.length > 0 && (
                <span className="text-[10px] text-magic-ink/50">
                  {extraColumns.length} manual column
                  {extraColumns.length === 1 ? "" : "s"} queued:{" "}
                  {extraColumns.map((c) => c.label).join(", ")}
                </span>
              )}
            </div>
          )}
        </QuotationPage>
      )}

      {systemPages.map((group, pageIdx) => (
        <QuotationPage
          key={group.system + pageIdx}
          header={header}
          setHeader={setHeader}
          editable={editable}
          logoUrl={logoUrl}
          pageLabel={`Page ${pageIdx + 1} of ${systemPages.length + 1}`}
          isLast={false}
        >
          <SystemBanner
            name={group.system}
            editable={editable}
            onRename={(v) => renameSystem(group.system, v)}
          />
          <SystemTable
            group={group}
            allPages={groups.map((g) => g.system)}
            showPictures={showPictures}
            editable={editable}
            extraColumns={extraColumns}
            priceDivisor={divisor}
            onUpdate={update}
            onRemove={removeRow}
            onToggleMerge={toggleMerge}
            onToggleMergeLeft={toggleMergeLeft}
            onRenameExtraColumn={renameExtraColumn}
            onRemoveExtraColumn={removeExtraColumn}
          />
          {editable && (
            <div className="no-print mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={() => addRowToSystem(group.system)}
                className="rounded-md border border-magic-border px-3 py-1 text-[11px] hover:bg-magic-soft"
              >
                + Add row to {group.system}
              </button>
              <button
                onClick={addManualItem}
                className="rounded-md border border-magic-border px-3 py-1 text-[11px] hover:bg-magic-soft"
                title="Add a blank row to any page (existing or brand new)"
              >
                + Add manual item
              </button>
              {/* Only show the "add column" button on the first group so the
               * user isn't tempted to add the same column multiple times —
               * manual columns are shared across every system table. */}
              {pageIdx === 0 && (
                <button
                  onClick={addExtraColumn}
                  className="rounded-md border border-magic-border px-3 py-1 text-[11px] hover:bg-magic-soft"
                  title="Add a manual column that shows up in every table"
                >
                  + Add manual column
                </button>
              )}
            </div>
          )}
        </QuotationPage>
      ))}

      {/* Final totals + terms page */}
      {systemPages.length > 0 && (
        <QuotationPage
          header={header}
          setHeader={setHeader}
          editable={editable}
          logoUrl={logoUrl}
          pageLabel={`Page ${systemPages.length + 1} of ${systemPages.length + 1}`}
          isLast
          hideInfoHeader
        >
          <ScopeIntro
            systems={groups.map((g) => g.system)}
            value={header.scope_intro}
            editable={editable}
            onChange={(v) => setHeader?.({ scope_intro: v })}
          />
          <div className="site-banner">Final Totals</div>
          <table>
            <tbody>
              <tr className="totals-row grand">
                <td style={{ width: "75%" }}>Grand Total Cost (Subtotal)</td>
                <td>{money(subtotal)}</td>
              </tr>
              {includeTax && (
                <tr className="totals-row">
                  <td>TAX ({header.tax_percent}%)</td>
                  <td>{money(tax)}</td>
                </tr>
              )}
              <tr className="totals-row">
                <td>Total Cost</td>
                <td>{money(total)}</td>
              </tr>
            </tbody>
          </table>

          <TermsBlock
            terms={terms}
            setTerms={setTerms}
            editable={editable}
            presalesEngineer={header.design_engineer || header.sales_engineer}
          />
        </QuotationPage>
      )}
    </div>
  );
}

// ─── Fixed full-bleed page (cover / about us) ────────────────────────────────

function StaticSheet({
  src,
  alt,
  isLast,
}: {
  src: string;
  alt: string;
  isLast?: boolean;
}) {
  return (
    <div
      className={`quotation-sheet full-bleed ${isLast ? "" : "page-break-after"}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} />
    </div>
  );
}

// ─── Page wrapper ────────────────────────────────────────────────────────────

function QuotationPage({
  header,
  setHeader,
  editable = false,
  logoUrl,
  pageLabel,
  isLast,
  hideInfoHeader,
  children,
}: {
  header: QuotationHeader;
  setHeader?: (patch: Partial<QuotationHeader>) => void;
  editable?: boolean;
  logoUrl?: string;
  pageLabel?: string;
  isLast?: boolean;
  /** When true, skip the project/client/engineer info grid on this page. */
  hideInfoHeader?: boolean;
  children: React.ReactNode;
}) {
  // Default to /logo.png in /public. Drop the real PNG at
  // public/logo.png and it will appear automatically. If the file
  // is missing we fall back to the Magic Tech text block.
  const resolvedLogo = logoUrl || "/logo.png";
  const [logoBroken, setLogoBroken] = React.useState(false);
  return (
    <div
      className={`quotation-sheet text-[11px] ${isLast ? "" : "page-break-after"}`}
    >
      {/* Top brand strip */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {!logoBroken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolvedLogo}
              alt="Magic Tech"
              className="h-14 w-auto object-contain"
              onError={() => setLogoBroken(true)}
            />
          ) : (
            <div>
              <div className="text-xs text-magic-ink/60">سحر التقنية</div>
              <div className="flex items-center gap-1">
                <span className="text-2xl font-black text-magic-red">Magic</span>
                <span className="text-2xl font-black text-magic-ink">Tech</span>
              </div>
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-3xl font-black">
            <span className="text-magic-ink">Sales </span>
            <span className="text-magic-red">Quotation</span>
          </div>
          {pageLabel && (
            <div className="text-[9px] text-magic-ink/50 mt-1">{pageLabel}</div>
          )}
        </div>
      </div>

      {/* Info header — left column pinned to the left edge, right column pinned
       * to the right edge. Each column is a 2-col mini-grid so labels and
       * values line up cleanly instead of floating against the edge. */}
      {!hideInfoHeader && (
        <div className="flex justify-between items-start gap-4 mb-3 text-[10.5px]">
          <div className="inline-grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <div className="col-span-2 font-bold">
              <HeaderField
                value={header.date || new Date().toLocaleDateString("en-GB")}
                editable={editable && !!setHeader}
                onChange={(v) => setHeader?.({ date: v })}
                bold
              />
            </div>
            <div className="text-left font-bold">Project:</div>
            <div className="text-left">
              <HeaderField
                value={header.project_name}
                placeholder="—"
                editable={editable && !!setHeader}
                onChange={(v) => setHeader?.({ project_name: v })}
              />
            </div>
            <div className="text-left font-bold">Client:</div>
            <div className="text-left">
              <HeaderField
                value={header.client_name || ""}
                placeholder="—"
                editable={editable && !!setHeader}
                onChange={(v) => setHeader?.({ client_name: v })}
              />
            </div>
            <div className="text-left font-bold">EMAIL:</div>
            <div className="text-left">
              <HeaderField
                value={header.client_email || ""}
                placeholder="—"
                editable={editable && !!setHeader}
                onChange={(v) => setHeader?.({ client_email: v })}
              />
            </div>
            <div className="text-left font-bold">Phone:</div>
            <div className="text-left">
              <HeaderField
                value={header.client_phone || ""}
                placeholder="—"
                editable={editable && !!setHeader}
                onChange={(v) => setHeader?.({ client_phone: v })}
              />
            </div>
          </div>
          <div className="inline-grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <div className="text-left font-bold">Ref:</div>
            <div className="text-left">
              <HeaderField
                value={header.ref}
                editable={editable && !!setHeader}
                onChange={(v) => setHeader?.({ ref: v })}
              />
            </div>
            <div className="text-left font-bold">Presales Engineer:</div>
            <div className="text-left">
              <HeaderField
                value={header.design_engineer || ""}
                placeholder="—"
                editable={editable && !!setHeader}
                onChange={(v) => setHeader?.({ design_engineer: v })}
              />
            </div>
            <div className="text-left font-bold">Phone:</div>
            <div className="text-left">
              <HeaderField
                value={header.sales_phone || "+962 795172566"}
                editable={editable && !!setHeader}
                onChange={(v) => setHeader?.({ sales_phone: v })}
              />
            </div>
            <div className="text-left font-bold">Sales Engineer:</div>
            <div className="text-left">
              <HeaderField
                value={header.sales_engineer || ""}
                placeholder="—"
                editable={editable && !!setHeader}
                onChange={(v) => setHeader?.({ sales_engineer: v })}
              />
            </div>
          </div>
        </div>
      )}

      {children}

      {/* Footer: company address — pinned to the bottom of every sheet. */}
      <div className="footer-address">
        Address: Amman- Gardens street- Khawaja Complex No.65- Tel: +962 65560272
        Fax: +962 65560275
      </div>
    </div>
  );
}

// ─── Header field (inline editable) ──────────────────────────────────────────

function HeaderField({
  value,
  onChange,
  editable,
  placeholder,
  bold,
}: {
  value: string;
  onChange: (v: string) => void;
  editable: boolean;
  placeholder?: string;
  bold?: boolean;
}) {
  if (!editable) {
    return (
      <span className={bold ? "font-bold" : undefined}>
        {value || placeholder || ""}
      </span>
    );
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-transparent outline-none border-b border-dotted border-magic-border focus:border-magic-red ${
        bold ? "font-bold" : ""
      }`}
    />
  );
}

// ─── System banner (editable) ────────────────────────────────────────────────

function SystemBanner({
  name,
  editable,
  onRename,
}: {
  name: string;
  editable: boolean;
  onRename: (v: string) => void;
}) {
  const [draft, setDraft] = React.useState(name);
  React.useEffect(() => setDraft(name), [name]);
  if (!editable) return <div className="site-banner">{name}</div>;
  return (
    <div className="site-banner">
      <input
        className="bg-transparent text-center font-bold w-full outline-none"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onRename(draft)}
      />
    </div>
  );
}

// ─── Table for one system group ──────────────────────────────────────────────

// Columns that support user-driven cell merging via `merge_up`. Quantity,
// total price, picture and the row "no" cell are intentionally excluded —
// merging a quantity would break subtotal math, and the others are either
// auto-computed or per-row by nature.
const MERGEABLE_COLUMNS = [
  "brand",
  "model",
  "description",
  "delivery",
  "unit_price",
] as const;

type MergeCol = (typeof MERGEABLE_COLUMNS)[number];

// Columns that support horizontal cell merging via `merge_left`. Scoped to
// the three contiguous text columns so a user can collapse a product's
// brand/model/description trio into a single wide cell without ever
// touching a numeric column. Because these three are rendered right next
// to each other (no Picture/Quantity in between), colSpan maths stay
// intuitive.
const H_MERGEABLE_COLUMNS = ["brand", "model", "description"] as const;

type HMergeCol = (typeof H_MERGEABLE_COLUMNS)[number];

interface MergePlan {
  /** rowSpan to apply when rendering this row's cell (≥ 1). */
  spans: Record<MergeCol, number[]>;
  /** true → skip rendering this row's cell; its span was folded into anchor */
  skip: Record<MergeCol, boolean[]>;
}

function computeMergePlan(
  rows: Array<{ item: QuotationItem; globalIndex: number }>,
): MergePlan {
  const spans = {} as Record<MergeCol, number[]>;
  const skip = {} as Record<MergeCol, boolean[]>;
  for (const col of MERGEABLE_COLUMNS) {
    const sp = new Array<number>(rows.length).fill(1);
    const sk = new Array<boolean>(rows.length).fill(false);
    let anchor = -1;
    for (let i = 0; i < rows.length; i++) {
      // First row can never merge up, and an orphan merge_up with no anchor
      // is treated as a normal cell rather than disappearing into nothing.
      const merged = i > 0 && !!rows[i].item.merge_up?.[col];
      if (merged && anchor >= 0) {
        sk[i] = true;
        sp[anchor] += 1;
      } else {
        anchor = i;
      }
    }
    spans[col] = sp;
    skip[col] = sk;
  }
  return { spans, skip };
}

interface HRowPlan {
  /** true → this cell is absorbed into an anchor to its left (don't render). */
  skip: Record<HMergeCol, boolean>;
  /** colSpan to apply when rendering this cell (≥ 1). */
  span: Record<HMergeCol, number>;
}

/**
 * Compute the horizontal merge plan for a single row. Walks the three
 * contiguous text columns left-to-right and, whenever a cell has
 * `merge_left` set, folds it into the most recent visible anchor on the
 * same row. Cells that the vertical plan has already skipped (merged
 * upward into a previous row) break the horizontal chain because the
 * spanned cell from above visually occupies that slot.
 */
function computeHRowPlan(
  item: QuotationItem,
  vSkip: Record<MergeCol, boolean[]>,
  rowIdx: number,
): HRowPlan {
  const skip = {} as Record<HMergeCol, boolean>;
  const span = {} as Record<HMergeCol, number>;
  for (const c of H_MERGEABLE_COLUMNS) {
    skip[c] = false;
    span[c] = 1;
  }
  let anchor: HMergeCol | null = null;
  for (const c of H_MERGEABLE_COLUMNS) {
    // Cell folded into a row above → not in this row's DOM at all.
    if (vSkip[c]?.[rowIdx]) {
      anchor = null;
      continue;
    }
    if (anchor && item.merge_left?.[c]) {
      skip[c] = true;
      span[anchor] += 1;
      // Keep the current anchor so a further-right column can still fold
      // into the same cell (e.g. description merging into the brand cell
      // that already absorbed model).
    } else {
      anchor = c;
    }
  }
  return { skip, span };
}

function SystemTable({
  group,
  allPages,
  showPictures,
  editable,
  extraColumns,
  priceDivisor = 1,
  onUpdate,
  onRemove,
  onToggleMerge,
  onToggleMergeLeft,
  onRenameExtraColumn,
  onRemoveExtraColumn,
}: {
  group: { system: string; rows: Array<{ item: QuotationItem; globalIndex: number }> };
  allPages: string[];
  showPictures: boolean;
  editable: boolean;
  extraColumns: QuotationExtraColumn[];
  priceDivisor?: number;
  onUpdate: (globalIndex: number, patch: Partial<QuotationItem>) => void;
  onRemove: (globalIndex: number) => void;
  onToggleMerge: (globalIndex: number, col: MergeCol) => void;
  onToggleMergeLeft: (globalIndex: number, col: HMergeCol) => void;
  onRenameExtraColumn: (id: string, label: string) => void;
  onRemoveExtraColumn: (id: string) => void;
}) {
  // Base = No, Brand, Model, Description, [Picture], Quantity, Delivery,
  // Unit Price, Total Price — plus one cell per manual column.
  const colCount = (showPictures ? 9 : 8) + extraColumns.length;
  // Pull out the items in their group order once so every downstream
  // calculation can resolve merged unit-price cells via effectiveMergedValue.
  const groupItems = group.rows.map((r) => r.item);
  const subtotal = group.rows.reduce((acc, _, rowIdx) => {
    const qty = Number(groupItems[rowIdx].quantity) || 0;
    const price =
      Number(effectiveMergedValue(groupItems, rowIdx, "unit_price")) || 0;
    return acc + qty * (price / priceDivisor);
  }, 0);
  // When manual columns are present, shrink the description column a bit so
  // everything still fits on A4 without horizontal overflow.
  const extraShare = Math.min(extraColumns.length * 7, 21); // max 21%
  const descWidth = showPictures ? 28 - extraShare : 36 - extraShare;

  const plan = computeMergePlan(group.rows);

  // Renders a mergeable cell that either:
  //   - is skipped (folded into an anchor above or to the left), or
  //   - gets a rowSpan / colSpan from the plan and the matching toggles.
  // Horizontal merging (merge_left) only applies on the three contiguous
  // text columns — for every other MergeCol `hPlan` is effectively a
  // no-op (span=1, skip=false), so the maths is identical to before.
  function mergeableCell(
    col: MergeCol,
    rowIdx: number,
    globalIndex: number,
    hPlan: HRowPlan,
    className: string,
    children: React.ReactNode,
  ): React.ReactNode {
    if (plan.skip[col][rowIdx]) return null;
    const isHMergeable = (H_MERGEABLE_COLUMNS as readonly string[]).includes(col);
    if (isHMergeable && hPlan.skip[col as HMergeCol]) return null;
    const rowSpan = plan.spans[col][rowIdx];
    const colSpan = isHMergeable ? hPlan.span[col as HMergeCol] : 1;
    const item = group.rows[rowIdx].item;
    const isMergedUp = rowIdx > 0 && !!item.merge_up?.[col];
    const isMergedLeft =
      isHMergeable && !!item.merge_left?.[col as HMergeCol];
    return (
      <td
        className={`relative ${className}`}
        rowSpan={rowSpan > 1 ? rowSpan : undefined}
        colSpan={colSpan > 1 ? colSpan : undefined}
      >
        {children}
        {editable && rowIdx > 0 && (
          <button
            type="button"
            onClick={() => onToggleMerge(globalIndex, col)}
            title={
              isMergedUp
                ? "Unmerge this cell from the row above"
                : "Merge this cell with the row above"
            }
            className={`no-print absolute top-0 right-0 w-4 h-4 text-[9px] leading-none rounded-bl ${
              isMergedUp
                ? "bg-magic-red text-white"
                : "bg-white/80 text-magic-ink/50 hover:bg-magic-soft"
            }`}
          >
            ⇧
          </button>
        )}
        {editable && isHMergeable && col !== "brand" && (
          <button
            type="button"
            onClick={() => onToggleMergeLeft(globalIndex, col as HMergeCol)}
            title={
              isMergedLeft
                ? "Unmerge this cell from the column on its left"
                : "Merge this cell with the column on its left"
            }
            className={`no-print absolute top-0 left-0 w-4 h-4 text-[9px] leading-none rounded-br ${
              isMergedLeft
                ? "bg-magic-red text-white"
                : "bg-white/80 text-magic-ink/50 hover:bg-magic-soft"
            }`}
          >
            ←
          </button>
        )}
      </td>
    );
  }

  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: "4%" }}>No</th>
          <th style={{ width: "10%" }}>Brand</th>
          <th style={{ width: "12%" }}>Model</th>
          <th style={{ width: `${descWidth}%` }}>Description</th>
          {showPictures && <th style={{ width: "10%" }}>Picture</th>}
          <th style={{ width: "6%" }}>Quantity</th>
          <th style={{ width: "8%" }}>Delivery</th>
          <th style={{ width: "10%" }}>Unit Price</th>
          <th style={{ width: "12%" }}>Total Price</th>
          {extraColumns.map((col) => (
            <th key={col.id} style={{ width: `${extraShare / Math.max(extraColumns.length, 1)}%` }}>
              {editable ? (
                <div className="flex items-center justify-center gap-1">
                  <input
                    className="w-full bg-transparent text-center uppercase font-bold text-magic-red"
                    value={col.label}
                    onChange={(e) => onRenameExtraColumn(col.id, e.target.value)}
                    aria-label="Rename manual column"
                  />
                  <button
                    onClick={() => onRemoveExtraColumn(col.id)}
                    className="no-print text-red-500 text-[10px] leading-none"
                    title="Remove this manual column"
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ) : (
                col.label
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {group.rows.length === 0 && (
          <tr>
            <td colSpan={colCount} className="py-3 text-magic-ink/50">
              No items in this system.
            </td>
          </tr>
        )}
        {group.rows.map(({ item, globalIndex }, rowIdx) => {
          const hPlan = computeHRowPlan(item, plan.skip, rowIdx);
          return (
          <tr key={globalIndex}>
            <td>{item.no}</td>
            {mergeableCell(
              "brand",
              rowIdx,
              globalIndex,
              hPlan,
              "font-bold",
              editable ? (
                <input
                  className="w-full bg-transparent text-center"
                  value={item.brand}
                  onChange={(e) => onUpdate(globalIndex, { brand: e.target.value })}
                />
              ) : (
                item.brand
              ),
            )}
            {mergeableCell(
              "model",
              rowIdx,
              globalIndex,
              hPlan,
              "font-semibold",
              editable ? (
                <input
                  className="w-full bg-transparent text-center"
                  value={item.model}
                  onChange={(e) => onUpdate(globalIndex, { model: e.target.value })}
                />
              ) : (
                item.model
              ),
            )}
            {mergeableCell(
              "description",
              rowIdx,
              globalIndex,
              hPlan,
              "text-left align-top",
              editable ? (
                <textarea
                  rows={3}
                  className="w-full bg-transparent text-[10.5px]"
                  value={item.description}
                  placeholder="Add a short description for this item…"
                  onChange={(e) =>
                    onUpdate(globalIndex, { description: e.target.value })
                  }
                />
              ) : (
                <div className="whitespace-pre-wrap text-left">
                  {item.description && item.description.trim()
                    ? item.description
                    : `${item.brand || ""} ${item.model || ""}`.trim() ||
                      "—"}
                </div>
              ),
            )}
            {showPictures && (
              <td>
                <PictureCell
                  item={item}
                  editable={editable}
                  onUpdate={(patch) => onUpdate(globalIndex, patch)}
                />
              </td>
            )}
            <td>
              {editable ? (
                <input
                  type="number"
                  className="w-full bg-transparent text-center"
                  value={item.quantity}
                  onChange={(e) =>
                    onUpdate(globalIndex, { quantity: Number(e.target.value) })
                  }
                />
              ) : (
                item.quantity
              )}
            </td>
            {mergeableCell(
              "delivery",
              rowIdx,
              globalIndex,
              hPlan,
              "",
              editable ? (
                <input
                  className="w-full bg-transparent text-center"
                  value={item.delivery}
                  onChange={(e) => onUpdate(globalIndex, { delivery: e.target.value })}
                />
              ) : (
                item.delivery
              ),
            )}
            {mergeableCell(
              "unit_price",
              rowIdx,
              globalIndex,
              hPlan,
              "",
              editable ? (
                <input
                  type="number"
                  className="w-full bg-transparent text-center"
                  value={item.unit_price}
                  onChange={(e) =>
                    onUpdate(globalIndex, { unit_price: Number(e.target.value) })
                  }
                />
              ) : (
                money(item.unit_price / priceDivisor)
              ),
            )}
            <td className="font-semibold">
              {money(
                (Number(item.quantity) || 0) *
                  ((Number(
                    effectiveMergedValue(groupItems, rowIdx, "unit_price"),
                  ) || 0) / priceDivisor),
              )}
              {editable && (
                <div className="no-print mt-1 flex items-center justify-center gap-1">
                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      if (v === "__new__") {
                        const name = prompt("Move to which page?", "");
                        if (name && name.trim())
                          onUpdate(globalIndex, { system: name.trim() });
                      } else {
                        onUpdate(globalIndex, { system: v });
                      }
                    }}
                    className="text-[9px] border border-magic-border rounded px-1 py-0.5 bg-white"
                    title="Move this row to another page"
                  >
                    <option value="">Move to…</option>
                    {allPages
                      .filter((p) => p !== group.system)
                      .map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    <option value="__new__">+ New page…</option>
                  </select>
                  <button
                    onClick={() => onRemove(globalIndex)}
                    className="text-red-500 text-[11px]"
                    title="Remove row"
                  >
                    ×
                  </button>
                </div>
              )}
            </td>
            {extraColumns.map((col) => {
              const cellValue = item.extra?.[col.id] || "";
              return (
                <td key={col.id} className="align-top">
                  {editable ? (
                    <input
                      className="w-full bg-transparent text-center"
                      value={cellValue}
                      onChange={(e) =>
                        onUpdate(globalIndex, {
                          extra: { ...(item.extra || {}), [col.id]: e.target.value },
                        })
                      }
                    />
                  ) : (
                    cellValue || "—"
                  )}
                </td>
              );
            })}
          </tr>
          );
        })}
        <tr className="totals-row">
          <td colSpan={colCount - 1}>{group.system} Subtotal</td>
          <td>{money(subtotal)}</td>
        </tr>
      </tbody>
    </table>
  );
}

// ─── Picture cell with manual upload ─────────────────────────────────────────

function PictureCell({
  item,
  editable,
  onUpdate,
}: {
  item: QuotationItem;
  editable: boolean;
  onUpdate: (patch: Partial<QuotationItem>) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const src = item.picture_url || "";

  function onPick(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onUpdate({ picture_url: String(reader.result || "") });
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex flex-col items-center justify-center gap-1">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={item.model}
          className="max-h-12 max-w-full object-contain"
        />
      ) : (
        <div className="text-[9px] text-magic-ink/40">no picture</div>
      )}
      {editable && (
        <div className="no-print flex items-center gap-1">
          <button
            onClick={() => fileRef.current?.click()}
            className="text-[9px] text-magic-red underline"
          >
            {src ? "Replace" : "Upload"}
          </button>
          {src && (
            <button
              onClick={() => onUpdate({ picture_url: "" })}
              className="text-[9px] text-magic-ink/50"
            >
              clear
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
        </div>
      )}
    </div>
  );
}

// ─── Project-scope intro (shown above the Final Totals table) ───────────────
// A short, professional paragraph that thanks the client and recaps the
// integrated solutions included in the quotation. Auto-generated from the
// system-group names on the previous pages, but the user can override it
// with any custom copy from the editor — their override is remembered.

function defaultScopeIntro(systems: string[]): string {
  const list = systems.filter(Boolean);
  if (list.length === 0) {
    return (
      "We sincerely appreciate the opportunity to collaborate with you on " +
      "this project and thank you for your continued trust in Magic " +
      "Technology. The following investment reflects the fully engineered " +
      "scope of works outlined in this proposal."
    );
  }
  const bulletList =
    list.length === 1
      ? list[0]
      : list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
  return (
    `We sincerely appreciate the opportunity to partner with you on this ` +
    `project and thank you for your continued trust in Magic Technology. ` +
    `As detailed in the preceding pages, the proposed scope of works has ` +
    `been carefully engineered to deliver a fully integrated solution ` +
    `covering ${bulletList}. Every component has been selected to ensure ` +
    `seamless interoperability, long-term reliability, and measurable value ` +
    `for your operation. The consolidated investment for the complete ` +
    `scope is summarised below.`
  );
}

function ScopeIntro({
  systems,
  value,
  editable,
  onChange,
}: {
  systems: string[];
  value?: string;
  editable: boolean;
  onChange: (v: string) => void;
}) {
  const fallback = defaultScopeIntro(systems);
  const text = value && value.trim() ? value : fallback;
  return (
    <div className="mb-3 text-[10.5px] leading-relaxed">
      <div className="border-b border-magic-ink/40 inline-block font-bold italic mb-2">
        Project Scope Summary
      </div>
      {editable ? (
        <textarea
          rows={5}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent border border-dotted border-magic-border rounded p-2 outline-none focus:border-magic-red text-justify"
          placeholder={fallback}
        />
      ) : (
        <p className="text-justify whitespace-pre-wrap">{text}</p>
      )}
    </div>
  );
}

// ─── Modular Terms & Conditions block ────────────────────────────────────────

function TermsBlock({
  terms,
  setTerms,
  editable,
  presalesEngineer,
}: {
  terms: string[];
  setTerms?: (t: string[]) => void;
  editable: boolean;
  presalesEngineer?: string;
}) {
  function update(i: number, v: string) {
    if (!setTerms) return;
    const next = terms.slice();
    next[i] = v;
    setTerms(next);
  }
  function remove(i: number) {
    if (!setTerms) return;
    setTerms(terms.filter((_, idx) => idx !== i));
  }
  function add() {
    if (!setTerms) return;
    setTerms([...terms, "New term"]);
  }

  return (
    <div className="mt-4 text-[10.5px]">
      <div className="border-b border-magic-ink/40 inline-block font-bold italic mb-2">
        Terms and conditions
      </div>
      <ul className="mt-2 space-y-1">
        {terms.map((t, i) => (
          <li key={i} className="flex items-start gap-1">
            <span>•</span>
            {editable ? (
              <>
                <input
                  value={t}
                  onChange={(e) => update(i, e.target.value)}
                  className="flex-1 bg-transparent border-b border-dotted border-magic-border outline-none"
                />
                <button
                  onClick={() => remove(i)}
                  className="no-print text-red-500 text-[9px]"
                  title="Remove term"
                >
                  ×
                </button>
              </>
            ) : (
              <span>{t}</span>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <button
          onClick={add}
          className="no-print mt-2 rounded-md border border-magic-border px-2 py-0.5 text-[10px] hover:bg-magic-soft"
        >
          + Add term
        </button>
      )}
      <p className="mt-3 font-bold italic">
        Presales Engineer: {presalesEngineer || "—"}
      </p>
    </div>
  );
}
