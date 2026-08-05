"use client";

import React, { useEffect, useRef, useState } from "react";
import Select from "@/components/Select";
import {
  computeQuotationTotals,
  effectiveMergedValue,
  type QuotationDiscount,
} from "@/lib/quotationTotals";
import {
  getBrandVariant,
  type BrandVariant,
} from "@/lib/brandVariants";

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
  /**
   * When true, this row is presented as an optional add-on: the Total
   * Price cell shows the word "Optional" instead of the computed amount
   * and the row is excluded from per-system subtotal, tax and grand
   * total. The unit price stays visible so the client can still see the
   * per-unit cost for reference.
   */
  optional?: boolean;
  /**
   * When true, the row is visually highlighted (a soft green "mark" tint)
   * on screen and in print so the user can flag important line items they
   * want the reader's eye to land on. Purely presentational — it has no
   * effect on totals, numbering, or merging.
   */
  marked?: boolean;
  /**
   * Internal, editor-only note attached to this row. Shown only in the
   * Designer (behind `no-print`) so the team can leave reminders / context on
   * a line, and it is DELIBERATELY excluded from every client-facing output —
   * the print sheet (no-print), the PDF, and the Excel export all render from
   * explicit columns that never include this field. Persisted with the row in
   * items_json so it survives save / reload.
   */
  note?: string;
  /**
   * Row type. Default ("item") is a normal product row with the usual
   * brand / model / quantity / price columns. "section" rows render as a
   * full-width banner inside the system table whose only payload is
   * `section_label` — they carry no number, no quantity, no price, are
   * skipped by renumbering and totals, and reset every merge anchor.
   * Used to visually divide a long page into sub-sections (e.g. an
   * "Outdoor Cameras" / "Indoor Cameras" split inside a CCTV table).
   */
  kind?: "item" | "section";
  /** Banner label shown when `kind === "section"`. */
  section_label?: string;
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
  /**
   * Optional discount applied to the subtotal before tax. `discount_mode`
   * selects whether `discount_percent` (a % of the subtotal) or
   * `discount_amount` (a fixed JOD figure) is authoritative. Absent on
   * quotations saved before discounts existed, which render with no
   * discount line at all.
   */
  discount_mode?: "percent" | "amount";
  discount_percent?: number;
  discount_amount?: number;
}

interface Props {
  header: QuotationHeader;
  items: QuotationItem[];
  setItems?: (items: QuotationItem[]) => void;
  setHeader?: (patch: Partial<QuotationHeader>) => void;
  editable?: boolean;
  /**
   * Explicit logo URL override. When omitted the logo is resolved via the
   * selected `brandVariantId` (or the default Magic Tech variant when no
   * variant is selected yet).
   */
  logoUrl?: string;
  /**
   * Id of the brand variant whose logo/cover/about artwork drives this
   * quotation. When unknown or invalid, falls back to the default Magic
   * Tech bundle so legacy quotations without a stored variant still
   * render the exact same sheets they always did.
   */
  brandVariantId?: string;
  /**
   * Admin-configured brand bundles (from app settings). When supplied,
   * `brandVariantId` is resolved against this list so the printed cover /
   * about-us / logo reflect what the admin set up. Falls back to the
   * built-in defaults when omitted.
   */
  brandVariants?: BrandVariant[];
  showPictures?: boolean;
  terms?: string[];
  setTerms?: (terms: string[]) => void;
  /**
   * Optional free-text notes shown under the Terms and conditions block.
   * Editable inline when `setNotes` is supplied; on the readonly / printed
   * view the block only renders when there's actually something to show.
   */
  notes?: string;
  setNotes?: (notes: string) => void;
  /** When false, tax is excluded from the total cost. Defaults to true. */
  includeTax?: boolean;
  /** When true, entered prices already contain tax — back-calculate base. */
  taxInclusive?: boolean;
  /**
   * When true, the client name / email / phone header fields render as
   * read-only even if the rest of the header is editable. Used by the
   * Designer when a client folder (CRM record) is selected — those
   * values come from the folder and are edited in the folder card.
   */
  clientLocked?: boolean;
  /**
   * When provided (and editable), the Client header field renders as a
   * dropdown so the user can choose which identity prints on the "Client:"
   * line — typically the individual client vs. the company it belongs to.
   * The parent owns the actual name / email / phone values; this only
   * reports the chosen key back so the parent can swap them.
   */
  clientOptions?: { key: string; label: string }[];
  /** Currently-selected client identity key (matches a `clientOptions` key). */
  clientIdentity?: string;
  /** Fired when the user picks a different client identity from the dropdown. */
  onClientIdentityChange?: (key: string) => void;
  /**
   * When true, the Project header field is read-only — its value is the name
   * of the project the quotation lives in and isn't free-text editable here.
   */
  projectLocked?: boolean;
  /**
   * Printable footer text shown at the bottom of every sheet. Admin-editable
   * via the Settings tab. Falls back to the historical hardcoded company
   * address when no setting has been saved yet.
   */
  footerText?: string;
  /**
   * Bill of Quantities mode. When true, the preview hides every pricing
   * column (Unit Price, Total Price) along with per-system subtotals and
   * the Final Totals page, so the user can print/export a pure scope
   * document the client can review without seeing commercial figures.
   * Terms and the scope intro still render because the BoQ is typically
   * attached as-is to the commercial offer.
   */
  boqMode?: boolean;
}

const DEFAULT_FOOTER_TEXT =
  "Address: Amman- Gardens street- Khawaja Complex No.65- Tel: +962 65560272 Fax: +962 65560275";

function money(n: number): string {
  return `JOD ${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

/**
 * Render a unit-price / row-total cell. A zero (or anything that
 * rounds to zero) is shown as "Free" in muted italics rather than a
 * blank — common ask from sales to flag complimentary line items
 * explicitly on the printed sheet.
 */
function renderPriceCell(n: number): React.ReactNode {
  const v = Number(n) || 0;
  if (v > 0) return money(v);
  return <span className="italic text-magic-ink/70">Free</span>;
}

// ─── Excel-aware clipboard readers ──────────────────────────────────────────
// Used by the "Paste column" button in every editable table header. We try
// the HTML clipboard payload first because when Excel (or Google Sheets)
// copies cells it embeds them as a <table> where each <td> is one real
// cell — including cells whose visible content is multi-line (Excel stores
// those internal line breaks as <br> inside the td). Parsing the table
// gives us per-cell strings with their line breaks preserved exactly.
//
// When the HTML part isn't available (e.g. a paste from a plain text
// source, or a browser that blocked clipboard.read), we fall back to a
// CSV-style parser over text/plain that honours double-quoted fields so
// Excel's convention of wrapping multi-line cells in quotes still yields
// one string per cell instead of one string per newline.
//
// Both paths return the FIRST column of the clipboard — which is what the
// user copied when they selected a single column in Excel. If the
// clipboard happens to carry multiple columns we silently ignore the
// others; the button is per-column and the user is pasting one column at
// a time by design.

/** Convert an HTML table cell into a string, replacing <br> with \n. */
function cellHtmlToText(cell: Element): string {
  const clone = cell.cloneNode(true) as HTMLElement;
  // Excel emits <br> between the physical lines of a multi-line cell; map
  // them back to real newlines so the string we hand to the designer is
  // the same thing the user sees in Excel.
  clone.querySelectorAll("br").forEach((br) => {
    br.replaceWith("\n");
  });
  // Paragraphs / divs also represent line breaks in some sources — flush
  // each to its own line before textContent collapses them.
  clone.querySelectorAll("p, div").forEach((block) => {
    block.append("\n");
  });
  return (clone.textContent || "").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").trim();
}

/**
 * When Excel copies a numeric cell, the rendered text is locale-formatted
 * (e.g. "1,234.56" or "1.234,56"), but the raw machine-readable value sits
 * on the <td> as `x:num="1234.56"` (Excel) or `sdval` (LibreOffice Calc).
 * Returning that raw value when present means a price column pastes
 * losslessly regardless of the user's locale or thousands separator
 * preference. Returns null when no machine value is exposed so callers
 * can fall back to the rendered text and parse it leniently.
 */
function cellRawNumber(cell: Element): string | null {
  const xnum = cell.getAttribute("x:num") || cell.getAttribute("sdval");
  if (xnum && xnum.trim()) return xnum.trim();
  return null;
}

/**
 * Parse a clipboard cell into a finite number, tolerant to Excel / Sheets
 * / Calc formatting. Handles:
 *   - Currency prefixes / suffixes ("$1,234.56", "1234 JD", "USD 99")
 *   - Thousands separators in any of:  ","  "."  " "  NBSP  "'"
 *   - en-US "1,234.56" AND EU "1.234,56" — the LAST separator is the
 *     decimal point; the others are stripped as thousands marks
 *   - A single separator with a 3-digit tail ("1,234") -> thousands mark,
 *     not a decimal — so users pasting "1,500" get 1500 instead of 1.5
 *   - Accounting-style negatives "(1,234.56)" -> -1234.56
 * Returns NaN when the input has no usable digits, leaving the choice
 * of fallback (0, 1, …) up to the caller.
 */
function parseClipboardNumber(
  raw: string,
  opts?: { assumeDecimal?: boolean },
): number {
  if (raw == null) return NaN;
  let s = String(raw).trim();
  if (!s) return NaN;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1).trim();
  }
  // Drop currency symbols, letters, and any other non-numeric chrome
  // Excel might emit (e.g. "USD", "JD", "kg"). Keep digits, separators,
  // leading sign and whitespace candidates only.
  s = s.replace(/[^\d.,\-+\s ']/g, "");
  if (s.startsWith("-")) {
    sign *= -1;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  // Whitespace (incl. NBSP) and apostrophes are pure thousands separators
  // across the locales Excel emits — strip them unconditionally.
  s = s.replace(/[\s ']/g, "");
  if (!s) return NaN;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot === -1 && lastComma === -1) {
    const n = Number(s);
    return Number.isFinite(n) ? sign * n : NaN;
  }
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: whichever comes later is the decimal point.
    const decimalChar = lastDot > lastComma ? "." : ",";
    const thousandsChar = decimalChar === "." ? "," : ".";
    s = s.split(thousandsChar).join("");
    if (decimalChar === ",") s = s.replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? sign * n : NaN;
  }
  // Only one separator type present.
  const onlyChar = lastDot >= 0 ? "." : ",";
  const occurrences = s.split(onlyChar).length - 1;
  const tail = s.slice(s.lastIndexOf(onlyChar) + 1);
  if (occurrences > 1) {
    // Multiple occurrences of the same separator -> all thousands.
    s = s.split(onlyChar).join("");
  } else if (opts?.assumeDecimal) {
    // Price-style field (JOD unit prices use 3-decimal fils): a lone
    // separator is the decimal point regardless of tail length, so
    // "175.250" -> 175.25 and "1.500" -> 1.5.
    if (onlyChar === ",") s = s.replace(",", ".");
  } else if (tail.length === 3 && /^\d+$/.test(tail)) {
    // Single separator + 3-digit tail -> thousands ("1,234" -> 1234).
    s = s.split(onlyChar).join("");
  } else if (onlyChar === ",") {
    // EU-style decimal: "1,5" -> 1.5.
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? sign * n : NaN;
}

function parseHtmlFirstColumn(html: string, opts?: { numeric?: boolean }): string[] {
  if (!html) return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return [];
  const rows = Array.from(table.querySelectorAll("tr"));
  const cells: string[] = [];
  for (const row of rows) {
    const firstCell = row.querySelector("td, th");
    if (!firstCell) continue;
    // For numeric targets (quantity / unit_price), prefer the cell's raw
    // machine value when Excel/Calc exposed one — that side-steps every
    // locale/thousands-separator parsing trap downstream.
    if (opts?.numeric) {
      const raw = cellRawNumber(firstCell);
      if (raw !== null) {
        cells.push(raw);
        continue;
      }
    }
    cells.push(cellHtmlToText(firstCell));
  }
  // Drop trailing completely-empty rows — Excel sometimes appends one.
  while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

/**
 * CSV/TSV parser that respects double-quoted fields (which may span
 * newlines and may contain tabs). Returns the FIRST column of every row
 * in the pasted payload. Intended as a fallback for when the HTML side
 * of the clipboard isn't accessible.
 */
function parsePlainFirstColumn(text: string): string[] {
  if (!text) return [];
  const rows: string[][] = [[""]];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const row = rows[rows.length - 1];
    const colIdx = row.length - 1;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          row[colIdx] += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        row[colIdx] += ch;
      }
      continue;
    }
    if (ch === '"' && row[colIdx] === "") {
      inQuotes = true;
      continue;
    }
    if (ch === "\t") {
      row.push("");
      continue;
    }
    if (ch === "\r") {
      // Treat as part of the upcoming \n; single \r line endings are rare.
      continue;
    }
    if (ch === "\n") {
      rows.push([""]);
      continue;
    }
    row[colIdx] += ch;
  }
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) {
    rows.pop();
  }
  return rows.map((r) => r[0] || "");
}

/**
 * Read a single column of cells out of the system clipboard, preferring
 * the Excel-provided HTML payload so multi-line cell content stays inside
 * one cell instead of being split on newlines. Returns an empty array
 * when the clipboard is empty or neither API path succeeded.
 */
async function readClipboardColumn(opts?: { numeric?: boolean }): Promise<string[]> {
  // Preferred path: navigator.clipboard.read() exposes every MIME type
  // Excel wrote, letting us grab text/html and parse it as a table.
  if (typeof navigator !== "undefined" && navigator.clipboard && "read" in navigator.clipboard) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes("text/html")) {
          const blob = await item.getType("text/html");
          const html = await blob.text();
          const cells = parseHtmlFirstColumn(html, opts);
          if (cells.length > 0) return cells;
        }
      }
      // HTML part missing (plain-text-only source): fall through to the
      // text path below using whatever we can read.
      for (const item of items) {
        if (item.types.includes("text/plain")) {
          const blob = await item.getType("text/plain");
          const text = await blob.text();
          const cells = parsePlainFirstColumn(text);
          if (cells.length > 0) return cells;
        }
      }
    } catch {
      // Permission denied / unsupported MIME / non-secure context →
      // fall through to readText below.
    }
  }
  // Final fallback: readText is more widely supported but only gives us
  // plain text, so multi-line cells MUST be in the Excel-style quoted
  // format for parsePlainFirstColumn to keep them in one string.
  if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
    try {
      const text = await navigator.clipboard.readText();
      return parsePlainFirstColumn(text);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Assign a 1-based row number to every item, counting independently
 * within each system group. Continuous global numbering (CCTV rows 1..9,
 * Sound rows 10..) made long quotations confusing — clients read each
 * system table as its own list, so the numbering needs to reset every
 * time a new system page starts.
 */
/**
 * True when a row is a section divider rather than a real product row.
 * Section rows are skipped by numbering, totals and merge anchors — they
 * exist purely to print a full-width banner inside a system table.
 */
export function isSectionRow(it: QuotationItem): boolean {
  return it?.kind === "section";
}

function renumber(items: QuotationItem[]): QuotationItem[] {
  const perSystem = new Map<string, number>();
  return items.map((it) => {
    if (isSectionRow(it)) return { ...it, no: 0 };
    const key = it.system || it.brand || "General";
    const next = (perSystem.get(key) ?? 0) + 1;
    perSystem.set(key, next);
    return { ...it, no: next };
  });
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
  brandVariantId,
  brandVariants,
  showPictures = false,
  terms = [],
  setTerms,
  notes = "",
  setNotes,
  includeTax = true,
  taxInclusive = false,
  clientLocked = false,
  clientOptions,
  clientIdentity,
  onClientIdentityChange,
  projectLocked = false,
  footerText,
  boqMode = false,
}: Props) {
  const resolvedFooterText =
    footerText && footerText.trim().length > 0 ? footerText : DEFAULT_FOOTER_TEXT;
  const brand: BrandVariant = getBrandVariant(brandVariantId, brandVariants);
  const resolvedLogoUrl = logoUrl || brand.logoUrl;
  // Resolve merged cells when summing so the Final Totals page matches
  // the per-group subtotals (and what the user visually sees in each
  // merged unit-price cell). Unit prices are stored in their final form
  // (Designer.toggleTaxInclusive transforms them at click time), so the
  // preview no longer applies any divisor — everything is displayed and
  // summed at face value.
  const effectiveTaxPercent = includeTax ? (header.tax_percent || 0) : 0;
  const discountSpec: QuotationDiscount = {
    mode: header.discount_mode === "amount" ? "amount" : "percent",
    percent: Number(header.discount_percent) || 0,
    amount: Number(header.discount_amount) || 0,
  };
  const { subtotal, discount, net, tax, total } = computeQuotationTotals(
    items,
    effectiveTaxPercent,
    taxInclusive,
    discountSpec,
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
   * Append a section-divider row at the end of the given system group.
   * Section rows are full-width banner labels used to break a long page
   * into sub-sections (e.g. "Outdoor Cameras" / "Indoor Cameras"). They
   * carry no number, no quantity and no price, and are skipped by every
   * total / merge / renumber path. We append to the end of `items` —
   * `groupBySystem` is order-preserving by system key, so the new row
   * lands at the end of its system table for free.
   */
  function addSectionRowToSystem(system: string) {
    if (!setItems) return;
    setItems(
      renumber([
        ...items,
        {
          no: 0,
          system,
          brand: "",
          model: "",
          description: "",
          quantity: 0,
          unit_price: 0,
          delivery: "",
          extra: {},
          kind: "section",
          section_label: "",
        },
      ]),
    );
  }

  /** Swap a section row with its previous (-1) or next (+1) sibling in
   *  the same system group. Section rows have no printed `no`, so the
   *  standard moveRowToNo input doesn't address them — these arrows are
   *  their dedicated reorder control. */
  function moveSectionRow(globalIndex: number, dir: -1 | 1) {
    if (!setItems) return;
    const cur = items[globalIndex];
    if (!cur || !isSectionRow(cur)) return;
    const curKey = cur.system || cur.brand || "General";
    const groupIndices: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const key = it.system || it.brand || "General";
      if (key === curKey) groupIndices.push(i);
    }
    const local = groupIndices.indexOf(globalIndex);
    const localTarget = local + dir;
    if (local < 0 || localTarget < 0 || localTarget >= groupIndices.length) {
      return;
    }
    const next = items.slice();
    const a = groupIndices[local];
    const b = groupIndices[localTarget];
    const tmp = next[a];
    next[a] = next[b];
    next[b] = tmp;
    setItems(renumber(next));
  }

  /**
   * Prompts for a table (system) name and creates a brand-new table for it,
   * seeded with one blank row so the new page actually renders. In this
   * quotation each "system" prints as its own table on its own page, so
   * "add a new table" is exactly "introduce a new system and start it off
   * with a row the user can fill in by hand". Used from the empty-state so
   * the user can start typing without first going through the catalog or
   * the AI designer, and from each page footer to spin up another table.
   */
  function addNewTable() {
    if (!setItems) return;
    const existingPages = Array.from(
      new Set(items.map((it) => it.system).filter(Boolean)),
    );
    const page = window.prompt(
      existingPages.length > 0
        ? `Name the new table (system) to add.\nExisting tables: ${existingPages.join(", ")}`
        : "Name the first table of this quotation (e.g. CCTV, Sound System)",
      "",
    );
    if (!page || !page.trim()) return;
    addRowToSystem(page.trim());
  }

  // ── Deleted-row undo stack ──────────────────────────────────────────
  // Every row the user trashes is pushed here (together with the index it
  // lived at) so Ctrl+Z can restore it in place. The stack lives in a
  // ref so toggling it never triggers a React re-render — the UI only
  // re-renders when we actually restore a row via `setItems`.
  const deletedRowsRef = useRef<
    Array<{ item: QuotationItem; index: number; stamp: number }>
  >([]);
  const [undoHintCount, setUndoHintCount] = useState(0);
  const [undoFlash, setUndoFlash] = useState<string | null>(null);

  function pushUndo(item: QuotationItem, index: number) {
    deletedRowsRef.current.push({ item, index, stamp: Date.now() });
    // Cap so a runaway paste-delete loop can't eat memory.
    if (deletedRowsRef.current.length > 50) deletedRowsRef.current.shift();
    setUndoHintCount(deletedRowsRef.current.length);
  }

  function restoreLastDeletedRow() {
    if (!setItems) return;
    const entry = deletedRowsRef.current.pop();
    setUndoHintCount(deletedRowsRef.current.length);
    if (!entry) {
      setUndoFlash("Nothing left to undo");
      window.setTimeout(() => setUndoFlash(null), 1500);
      return;
    }
    // Clamp the restore index to the current array length so we never
    // throw on splice() after the user has been busy with other edits.
    const insertAt = Math.max(0, Math.min(entry.index, items.length));
    const next = items.slice();
    next.splice(insertAt, 0, entry.item);
    setItems(renumber(next));
    setUndoFlash(
      `Restored row: ${[entry.item.brand, entry.item.model]
        .filter(Boolean)
        .join(" ") || entry.item.description || "row"}`,
    );
    window.setTimeout(() => setUndoFlash(null), 1800);
  }

  // Ctrl/Cmd+Z anywhere on the Designer restores the most recently
  // deleted row. We ignore the shortcut when the user is editing a form
  // input (inputs/textareas have their own native undo, and stealing it
  // would ruin typing). Only active while the preview is editable.
  useEffect(() => {
    if (!editable) return;
    function onKeyDown(e: KeyboardEvent) {
      const isUndo =
        (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z";
      if (!isUndo) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      restoreLastDeletedRow();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, items]);

  function removeRow(i: number) {
    if (!setItems) return;
    const victim = items[i];
    if (victim) pushUndo(victim, i);
    setItems(renumber(items.filter((_, idx) => idx !== i)));
  }

  // Moves a row to an explicit target "No" (the 1-based running number
  // printed on the PDF). `no` is now local to each system group, so the
  // typed value maps directly to a local index within that group and we
  // simply clamp it to the group bounds — typing out-of-range snaps to
  // the nearest valid in-group slot.
  function moveRowToNo(globalIndex: number, targetNo: number) {
    if (!setItems) return;
    const cur = items[globalIndex];
    if (!cur) return;
    if (isSectionRow(cur)) return; // sections move via their own arrows
    const curKey = cur.system || cur.brand || "General";
    // Only item rows are addressable by `no` — section dividers are
    // skipped from the index map so swapping past one moves both
    // adjacent items past it together via the per-step swap loop below.
    const groupIndices: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const key = it.system || it.brand || "General";
      if (key !== curKey) continue;
      if (isSectionRow(it)) continue;
      groupIndices.push(i);
    }
    if (groupIndices.length === 0) return;
    const localCur = groupIndices.indexOf(globalIndex);
    if (localCur < 0) return;
    const localTarget = Math.max(
      0,
      Math.min(Math.trunc(targetNo) - 1, groupIndices.length - 1),
    );
    if (localTarget === localCur) return;
    // Perform the move by repeatedly swapping adjacent siblings in the
    // direction of travel — this preserves the "never interleave system
    // groups" invariant that moveRow() already guaranteed.
    const step = localTarget > localCur ? 1 : -1;
    const next = items.slice();
    let from = localCur;
    while (from !== localTarget) {
      const a = groupIndices[from];
      const b = groupIndices[from + step];
      const tmp = next[a];
      next[a] = next[b];
      next[b] = tmp;
      from += step;
    }
    setItems(renumber(next));
  }

  /**
   * Move a row to a new position in the same system group via drag-and-drop.
   * `fromGlobal` and `toGlobal` are indices into the live `items` array.
   * Cross-group drops are rejected here so the existing "never interleave
   * systems" invariant — already enforced by moveRowToNo / moveSectionRow —
   * stays intact when the dragged row would otherwise land on a sibling in
   * another system's table.
   */
  function moveRowWithinGroup(fromGlobal: number, toGlobal: number) {
    if (!setItems) return;
    if (fromGlobal === toGlobal) return;
    const fromItem = items[fromGlobal];
    const toItem = items[toGlobal];
    if (!fromItem || !toItem) return;
    const fromKey = fromItem.system || fromItem.brand || "General";
    const toKey = toItem.system || toItem.brand || "General";
    if (fromKey !== toKey) return;
    const next = items.slice();
    const [moved] = next.splice(fromGlobal, 1);
    // After splice the trailing indices shift back by one, so the target
    // slot needs the same adjustment when dragging downward.
    const insertAt = toGlobal > fromGlobal ? toGlobal - 1 : toGlobal;
    next.splice(insertAt, 0, moved);
    setItems(renumber(next));
  }

  /** Duplicate a row, inserting the copy right after the original. */
  function duplicateRow(globalIndex: number) {
    if (!setItems) return;
    const src = items[globalIndex];
    if (!src) return;
    const copy: QuotationItem = {
      ...src,
      no: 0,
      // Clear merge flags so the duplicate starts as an independent row.
      merge_up: undefined,
      merge_left: undefined,
    };
    const next = items.slice();
    next.splice(globalIndex + 1, 0, copy);
    setItems(renumber(next));
  }

  /** Copy a row to the internal clipboard (stored on window for simplicity). */
  function copyRow(globalIndex: number) {
    const src = items[globalIndex];
    if (!src) return;
    (window as unknown as Record<string, unknown>).__qt_clipboard = { ...src };
  }

  /** Paste the clipboard row after the given index, inheriting the target system. */
  function pasteRow(globalIndex: number) {
    if (!setItems) return;
    const clip = (window as unknown as Record<string, unknown>).__qt_clipboard as QuotationItem | undefined;
    if (!clip) return;
    const target = items[globalIndex];
    const copy: QuotationItem = {
      ...clip,
      no: 0,
      system: target?.system || clip.system,
      merge_up: undefined,
      merge_left: undefined,
    };
    const next = items.slice();
    next.splice(globalIndex + 1, 0, copy);
    setItems(renumber(next));
  }

  // The up/down arrow UI that used `moveRow` has been replaced with a
  // "jump to No" input driven by `moveRowToNo` below. See that function
  // for the reorder logic.

  // ── Per-merge undo stack ────────────────────────────────────────────
  // Every time a cell is MERGED (not unmerged) we snapshot the current
  // items[] so the toolbar's "Undo last merge" button can pop the last
  // snapshot and revert just that one merge. This matters because
  // `toggleMerge` has a side effect — it copies the anchor row's value
  // into the merged row's own column — so a flag-only reversal would
  // leave the row's value pointing at the anchor's data. A snapshot
  // restores both the merge flag and the original value in one step.
  // Stack is capped so a runaway batch can't eat memory.
  const mergeUndoStackRef = useRef<QuotationItem[][]>([]);
  const [mergeUndoCount, setMergeUndoCount] = useState(0);

  function pushMergeSnapshot() {
    const snapshot = items.map((it) => ({
      ...it,
      merge_up: it.merge_up ? { ...it.merge_up } : undefined,
      merge_left: it.merge_left ? { ...it.merge_left } : undefined,
      extra: it.extra ? { ...it.extra } : undefined,
    }));
    mergeUndoStackRef.current.push(snapshot);
    if (mergeUndoStackRef.current.length > 30) {
      mergeUndoStackRef.current.shift();
    }
    setMergeUndoCount(mergeUndoStackRef.current.length);
  }

  function undoLastMerge() {
    if (!setItems) return;
    const prev = mergeUndoStackRef.current.pop();
    setMergeUndoCount(mergeUndoStackRef.current.length);
    if (!prev) return;
    setItems(prev);
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
    // Snapshot before we actually merge, so "Undo last merge" can
    // restore the row's original value alongside the flag.
    pushMergeSnapshot();
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

  // Undoes a vertical merge by clearing the `merge_up` flag on every row
  // currently folded into `anchorGlobalIndex` for this column. Necessary
  // because merged child cells are skipped from the DOM entirely, so the
  // only place a user can click to unmerge is the anchor cell itself.
  function unmergeCell(anchorGlobalIndex: number, col: MergeCol) {
    if (!setItems) return;
    const anchor = items[anchorGlobalIndex];
    if (!anchor) return;
    const anchorKey = anchor.system || anchor.brand || "General";
    const next = items.slice();
    for (let i = anchorGlobalIndex + 1; i < next.length; i++) {
      const it = next[i];
      const key = it.system || it.brand || "General";
      if (key !== anchorKey) break;
      if (!it.merge_up?.[col]) break;
      const merge_up = { ...it.merge_up };
      delete merge_up[col];
      next[i] = { ...it, merge_up };
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
      // Snapshot before we merge so "Undo last merge" can roll this
      // single merge back without affecting any other cells.
      pushMergeSnapshot();
      merge_left[col] = true;
    }
    next[globalIndex] = { ...cur, merge_left };
    setItems(next);
  }

  // Bulk "undo" for the cell-merging affordances. Pre-existed only as a
  // per-cell ⇩ / ← toggle, which is fine for a one-off mistake but
  // tedious once a few rows have been collapsed together. `keepSystem`
  // narrows the wipe to a single page; passing null clears every merge
  // flag on every row. The merge_up / merge_left objects are dropped
  // entirely rather than blanked so JSON round-trips stay clean.
  function unmergeAllRows(keepSystem: string | null) {
    if (!setItems) return;
    let changed = false;
    const next = items.map((it) => {
      if (keepSystem !== null) {
        const key = it.system || it.brand || "General";
        if (key !== keepSystem) return it;
      }
      const hasUp =
        it.merge_up && Object.keys(it.merge_up).length > 0;
      const hasLeft =
        it.merge_left && Object.keys(it.merge_left).length > 0;
      if (!hasUp && !hasLeft) return it;
      changed = true;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { merge_up: _u, merge_left: _l, ...rest } = it;
      return rest as QuotationItem;
    });
    if (changed) setItems(next);
  }

  // Flips the `optional` flag on a row. Optional rows keep their stored
  // unit price visible but render "Optional" in the Total Price cell and
  // contribute 0 to the subtotal / tax / grand total — useful for
  // presenting add-ons whose price the client should see but which the
  // sales team is not committing to in the offer.
  function toggleOptional(globalIndex: number) {
    if (!setItems) return;
    const next = items.slice();
    const cur = next[globalIndex];
    if (!cur) return;
    next[globalIndex] = { ...cur, optional: !cur.optional };
    setItems(next);
  }

  // Flips the `marked` highlight flag on a row. Purely visual — it tints the
  // row green on screen and in print so the user can call attention to key
  // line items without touching totals, numbering, or merge state.
  function toggleMark(globalIndex: number) {
    if (!setItems) return;
    const next = items.slice();
    const cur = next[globalIndex];
    if (!cur) return;
    next[globalIndex] = { ...cur, marked: !cur.marked };
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

  // ── Paste a whole Excel column into one designer column ────────────────
  // Triggered by the 📋 button on top of each editable column header. We
  // read the system clipboard (preferring Excel's HTML payload so multi-
  // line cells stay intact) and drop each cell value into the next row of
  // the target system page, creating new rows when the clipboard has more
  // entries than the table does. Unlike a split-on-newline paste, this
  // respects the user's original Excel cell boundaries — a cell that
  // contains "Line A\nLine B" in Excel lands in ONE description cell
  // here, with the newline preserved.
  async function pasteColumnFromClipboard(system: string, colKey: string) {
    if (!setItems) return;
    // Tell the clipboard reader to prefer Excel's `x:num` raw machine
    // value over the locale-formatted display text so a price column
    // like "1,234.56" / "1.234,56" survives the round trip intact.
    const numericTarget = colKey === "quantity" || colKey === "unit_price";
    const cells = await readClipboardColumn({ numeric: numericTarget });
    if (cells.length === 0) {
      window.alert(
        "Nothing to paste. Copy a column of cells from Excel (or Google Sheets) first, then click the 📋 button again.\n\n" +
          "If the browser blocked clipboard access, reload the page and try once more — it asks for permission on the first read."
      );
      return;
    }

    // Convert one clipboard cell into a patch for the target column.
    // Numeric columns route through parseClipboardNumber so locale-
    // formatted prices ("$1,234.56", "1.234,56", "(99.00)") all coerce
    // cleanly. Text columns keep the full multi-line string (including
    // internal \n) so the Description textarea renders it verbatim.
    function patchForCell(raw: string): Partial<QuotationItem> {
      if (colKey === "quantity") {
        const n = parseClipboardNumber(raw);
        return { quantity: Number.isFinite(n) && n > 0 ? n : 1 };
      }
      if (colKey === "unit_price") {
        const n = parseClipboardNumber(raw, { assumeDecimal: true });
        return { unit_price: Number.isFinite(n) ? n : 0 };
      }
      if (colKey.startsWith("extra:")) {
        const colId = colKey.slice("extra:".length);
        return { extra: { [colId]: raw } };
      }
      return { [colKey]: raw } as Partial<QuotationItem>;
    }

    // Global indices of rows currently on the target system page, in
    // document order. Filling starts at the first row of the page.
    const groupIndices: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const sys = items[i].system || items[i].brand || "General";
      if (sys === system) groupIndices.push(i);
    }

    const next = items.slice();
    let cursor = 0;

    // Phase 1 — overwrite every existing row on this page with the next
    // clipboard cell, one by one. The `extra` object needs a merge (not
    // a replace) so the other manual columns on the row survive the
    // update.
    for (
      let local = 0;
      local < groupIndices.length && cursor < cells.length;
      local++, cursor++
    ) {
      const g = groupIndices[local];
      const patch = patchForCell(cells[cursor]);
      if (patch.extra) {
        next[g] = {
          ...next[g],
          extra: { ...(next[g].extra || {}), ...patch.extra },
        };
      } else {
        next[g] = { ...next[g], ...patch };
      }
    }

    // Phase 2 — any leftover clipboard cells spill into brand new rows
    // appended right after the last existing row of this page, so they
    // stay inside the same printed system group.
    if (cursor < cells.length) {
      const insertAt =
        groupIndices.length > 0
          ? groupIndices[groupIndices.length - 1] + 1
          : next.length;
      const newRows: QuotationItem[] = [];
      for (; cursor < cells.length; cursor++) {
        const base: QuotationItem = {
          no: 0,
          system,
          brand: "",
          model: "",
          description: `New ${system} item — please add a short description.`,
          quantity: 1,
          unit_price: 0,
          delivery: "TBD",
          extra: {},
        };
        const patch = patchForCell(cells[cursor]);
        if (patch.extra) {
          newRows.push({
            ...base,
            extra: { ...(base.extra || {}), ...patch.extra },
          });
        } else {
          newRows.push({ ...base, ...patch });
        }
      }
      next.splice(insertAt, 0, ...newRows);
    }

    setItems(renumber(next));
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
      {/* Undo feedback toast — shown briefly after Ctrl/Cmd+Z restores a
          row (or fails to, when the stack is empty). Hidden in print. */}
      {editable && undoFlash && (
        <div className="no-print fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-magic-ink/90 px-4 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur">
          ↶ {undoFlash}
        </div>
      )}
      {/* Small "undo available" hint badge, fixed bottom-left. Stays out
          of the user's way but lets them know Ctrl+Z has something to
          restore without reading the docs. */}
      {editable && undoHintCount > 0 && (
        <div
          className="no-print fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full border border-magic-border/60 bg-white/85 px-3 py-1.5 text-[11px] font-medium text-magic-ink/70 shadow-mt-soft backdrop-blur"
          title="Press Ctrl/Cmd+Z to restore the most recently deleted row"
        >
          <span className="rounded-md bg-magic-red/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-magic-red">
            ⌘Z
          </span>
          Undo delete ({undoHintCount})
        </div>
      )}
      {/* Fixed front matter — printed in order: cover, then about us. Both
       * are only visible in the print output (hidden on screen via CSS).
       * The artwork tracks the selected brand variant, so swapping the
       * printed logo also swaps in its paired cover / about-us sheets. */}
      <StaticSheet src={brand.coverUrl} alt={`${brand.label} cover page`} />
      {brand.aboutUrl && (
        <StaticSheet src={brand.aboutUrl} alt={`${brand.label} about us page`} />
      )}

      {systemPages.length === 0 && (
        <QuotationPage
          header={header}
          setHeader={setHeader}
          editable={editable}
          logoUrl={resolvedLogoUrl}
          clientLocked={clientLocked}
          clientOptions={clientOptions}
          clientIdentity={clientIdentity}
          onClientIdentityChange={onClientIdentityChange}
          projectLocked={projectLocked}
          footerText={resolvedFooterText}
          isLast={!editable}
        >
          <p className="py-6 text-center text-magic-ink/50 text-xs">
            No items yet. Add products from the Catalogue, use the AI Designer,
            or start from scratch with the buttons below.
          </p>
          {editable && (
            <div className="no-print flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={addNewTable}
                className="rounded-md bg-magic-red text-white px-3 py-1.5 text-[11px] font-semibold hover:bg-red-700"
                title="Create a new table (system page) and start it with a blank row you can fill in by hand"
              >
                + Add a new table
              </button>
              <button
                onClick={addExtraColumn}
                className="rounded-md border border-magic-border px-3 py-1.5 text-[11px] hover:bg-magic-soft"
                title="Add a manual column that will show up in every table"
              >
                + Add manual column
              </button>
              <button
                onClick={() => unmergeAllRows(null)}
                className="rounded-md border border-magic-border px-3 py-1.5 text-[11px] hover:bg-magic-soft"
                title="Undo every cell merge across every page"
              >
                ↺ Unmerge all cells
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
          logoUrl={resolvedLogoUrl}
          clientLocked={clientLocked}
          clientOptions={clientOptions}
          clientIdentity={clientIdentity}
          onClientIdentityChange={onClientIdentityChange}
          projectLocked={projectLocked}
          footerText={resolvedFooterText}
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
            boqMode={boqMode}
            onUpdate={update}
            onRemove={removeRow}
            onJumpTo={moveRowToNo}
            onDuplicate={duplicateRow}
            onCopy={copyRow}
            onPaste={pasteRow}
            onToggleMerge={toggleMerge}
            onUnmergeCell={unmergeCell}
            onToggleMergeLeft={toggleMergeLeft}
            onToggleOptional={toggleOptional}
            onToggleMark={toggleMark}
            onMoveSection={moveSectionRow}
            onMoveRow={moveRowWithinGroup}
            onRenameExtraColumn={renameExtraColumn}
            onRemoveExtraColumn={removeExtraColumn}
            onPasteColumn={pasteColumnFromClipboard}
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
                onClick={() => addSectionRowToSystem(group.system)}
                className="rounded-md border border-magic-border px-3 py-1 text-[11px] hover:bg-magic-soft"
                title="Insert a full-width section divider (e.g. 'Outdoor Cameras') at the bottom of this page. The divider has no number or price."
              >
                + Section divider
              </button>
              <button
                onClick={addNewTable}
                className="rounded-md border border-magic-border px-3 py-1 text-[11px] hover:bg-magic-soft"
                title="Create another table (system page) seeded with a blank row"
              >
                + Add a new table
              </button>
              <button
                onClick={undoLastMerge}
                disabled={mergeUndoCount === 0}
                className="rounded-md border border-magic-border px-3 py-1 text-[11px] hover:bg-magic-soft disabled:opacity-40 disabled:cursor-not-allowed"
                title={
                  mergeUndoCount > 0
                    ? `Undo only the most recent cell merge (${mergeUndoCount} step${mergeUndoCount === 1 ? "" : "s"} available)`
                    : "Nothing to undo yet — merge a cell first"
                }
              >
                ↺ Undo last merge
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
          logoUrl={resolvedLogoUrl}
          clientLocked={clientLocked}
          footerText={resolvedFooterText}
          isLast
          hideInfoHeader
        >
          <ScopeIntro
            systems={groups.map((g) => g.system)}
            value={header.scope_intro}
            editable={editable}
            onChange={(v) => setHeader?.({ scope_intro: v })}
          />
          {/* Hide the Final Totals table entirely in BoQ mode — a Bill of
           * Quantities is a pricing-free scope document by definition. The
           * terms block below still renders because clients review the
           * same terms whether they're looking at the commercial offer or
           * the BoQ attachment. */}
          {!boqMode && (
            <>
              <div className="site-banner">Final Totals</div>
              <table>
                <tbody>
                  <tr className="totals-row grand">
                    <td style={{ width: "75%" }}>Grand Total Cost (Subtotal)</td>
                    <td>{money(subtotal)}</td>
                  </tr>
                  {discount > 0 && (
                    <tr className="totals-row">
                      <td>
                        Discount
                        {discountSpec.mode === "percent" &&
                        discountSpec.percent > 0
                          ? ` (${discountSpec.percent}%)`
                          : ""}
                      </td>
                      <td>− {money(discount)}</td>
                    </tr>
                  )}
                  {discount > 0 && includeTax && (
                    <tr className="totals-row">
                      <td>Net After Discount</td>
                      <td>{money(net)}</td>
                    </tr>
                  )}
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
            </>
          )}

          <TermsBlock
            terms={terms}
            setTerms={setTerms}
            editable={editable}
            notes={notes}
            setNotes={setNotes}
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
  isLast,
  hideInfoHeader,
  clientLocked = false,
  clientOptions,
  clientIdentity,
  onClientIdentityChange,
  projectLocked = false,
  footerText,
  children,
}: {
  header: QuotationHeader;
  setHeader?: (patch: Partial<QuotationHeader>) => void;
  editable?: boolean;
  logoUrl?: string;
  isLast?: boolean;
  /** When true, skip the project/client/engineer info grid on this page. */
  hideInfoHeader?: boolean;
  /** When true, the client name/email/phone inputs render read-only. */
  clientLocked?: boolean;
  /** Client-identity dropdown options (Client vs Company). */
  clientOptions?: { key: string; label: string }[];
  clientIdentity?: string;
  onClientIdentityChange?: (key: string) => void;
  /** When true, the Project field is read-only (driven by the project). */
  projectLocked?: boolean;
  /** Admin-editable printable footer line. */
  footerText?: string;
  children: React.ReactNode;
}) {
  // Default to /logo.png in /public. Drop the real PNG at
  // public/logo.png and it will appear automatically. If the file
  // is missing we fall back to the Magic Tech text block.
  const resolvedLogo = logoUrl || "/logo.png";
  // Some variants (e.g. BEAT) ship their asset as a `.jpeg` while the
  // registry used to reference `.png` — and vice versa. Rather than
  // hard-failing to the text block on the first miss, we swap the
  // common image extension once and retry, so either file wins.
  const swapLogoExt = (url: string): string | null => {
    if (/\.png($|\?)/i.test(url)) return url.replace(/\.png(?=$|\?)/i, ".jpeg");
    if (/\.jpeg($|\?)/i.test(url)) return url.replace(/\.jpeg(?=$|\?)/i, ".png");
    if (/\.jpg($|\?)/i.test(url)) return url.replace(/\.jpg(?=$|\?)/i, ".png");
    return null;
  };
  const [logoSrc, setLogoSrc] = React.useState(resolvedLogo);
  const [logoBroken, setLogoBroken] = React.useState(false);
  // Reset the retry chain whenever the caller hands us a new URL so
  // switching brand variants doesn't reuse a previously-exhausted src.
  React.useEffect(() => {
    setLogoSrc(resolvedLogo);
    setLogoBroken(false);
  }, [resolvedLogo]);
  // Rendering the sheet as a <table> with <thead>/<tfoot> lets print
  // engines repeat the brand strip and footer at the top/bottom of every
  // physical page that the system table overflows onto. The brand strip
  // is intentionally kept small — bigger running headers (e.g. embedding
  // the full project info grid) get clipped by Chrome on overflow pages,
  // which is what produced the partial header / missing logo regression.
  const brandStrip = (
    <div className="flex items-start justify-between mb-3">
      <div className="flex items-center gap-3">
        {!logoBroken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoSrc}
            alt="Magic Tech"
            className="h-14 w-auto object-contain"
            onError={() => {
              const alt = swapLogoExt(logoSrc);
              if (alt && alt !== logoSrc) {
                setLogoSrc(alt);
              } else {
                setLogoBroken(true);
              }
            }}
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
      </div>
    </div>
  );

  // Project / client / engineer grid. Lives inside the body cell so it
  // appears once at the top of the first physical page of each system
  // group rather than being repeated (and clipped) on every overflow
  // page by the running <thead>.
  const infoHeader = !hideInfoHeader && (
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
                editable={editable && !!setHeader && !projectLocked}
                onChange={(v) => setHeader?.({ project_name: v })}
              />
            </div>
            <div className="text-left font-bold">Client:</div>
            <div className="text-left">
              {editable && clientOptions && clientOptions.length > 1 ? (
                // Pick which identity prints on the Client line — the client
                // folder, or the company it belongs to. Only shown when there
                // is a genuine choice (the folder belongs to a company); a
                // standalone client just renders its locked name below. The
                // parent swaps the name / email / phone to match the key.
                <Select
                  value={clientIdentity || clientOptions[0].key}
                  onChange={(next) => onClientIdentityChange?.(next)}
                  aria-label="Client identity"
                  title="Choose whether the client name or the company name appears here — its email and phone fill in automatically."
                  className="w-full min-w-0 rounded-none border-0 border-b border-dotted border-magic-border bg-transparent px-0 py-0 text-inherit shadow-none focus:border-magic-red focus:ring-0"
                >
                  {clientOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <HeaderField
                  value={header.client_name || ""}
                  placeholder="—"
                  editable={editable && !!setHeader && !clientLocked}
                  onChange={(v) => setHeader?.({ client_name: v })}
                />
              )}
            </div>
            <div className="text-left font-bold">EMAIL:</div>
            <div className="text-left">
              <HeaderField
                value={header.client_email || ""}
                placeholder="—"
                editable={editable && !!setHeader && !clientLocked}
                onChange={(v) => setHeader?.({ client_email: v })}
              />
            </div>
            <div className="text-left font-bold">Phone:</div>
            <div className="text-left">
              <HeaderField
                value={header.client_phone || ""}
                placeholder="—"
                editable={editable && !!setHeader && !clientLocked}
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
                value={header.sales_phone || ""}
                placeholder="—"
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
  );

  // Page-frame table: <thead> = running brand strip (repeats at the top of
  // every physical page in print), <tbody> = page body, <tfoot> = running
  // address footer (repeats at the bottom of every physical page in print).
  // The outer `.quotation-sheet` is plain block in print so this table
  // fragments cleanly across pages — see `@media print` in globals.css.
  return (
    <section
      className={`quotation-sheet text-[11px] ${isLast ? "" : "page-break-after"}`}
    >
      <table className="sheet-layout">
        <thead>
          <tr>
            <td>{brandStrip}</td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="sheet-body-cell">
              {infoHeader}
              {children}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td>
              <div className="footer-address whitespace-pre-wrap">
                {footerText && footerText.trim().length > 0
                  ? footerText
                  : DEFAULT_FOOTER_TEXT}
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
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
      // Section rows are full-width banners — they don't take part in
      // any per-column merge chain, so they reset the anchor and must
      // never be folded into a span themselves.
      if (isSectionRow(rows[i].item)) {
        anchor = -1;
        continue;
      }
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
  boqMode = false,
  onUpdate,
  onRemove,
  onJumpTo,
  onDuplicate,
  onCopy,
  onPaste,
  onToggleMerge,
  onUnmergeCell,
  onToggleMergeLeft,
  onToggleOptional,
  onToggleMark,
  onMoveSection,
  onMoveRow,
  onRenameExtraColumn,
  onRemoveExtraColumn,
  onPasteColumn,
}: {
  group: { system: string; rows: Array<{ item: QuotationItem; globalIndex: number }> };
  allPages: string[];
  showPictures: boolean;
  editable: boolean;
  extraColumns: QuotationExtraColumn[];
  boqMode?: boolean;
  onUpdate: (globalIndex: number, patch: Partial<QuotationItem>) => void;
  onRemove: (globalIndex: number) => void;
  onJumpTo: (globalIndex: number, targetNo: number) => void;
  onDuplicate: (globalIndex: number) => void;
  onCopy: (globalIndex: number) => void;
  onPaste: (globalIndex: number) => void;
  onToggleMerge: (globalIndex: number, col: MergeCol) => void;
  onUnmergeCell: (anchorGlobalIndex: number, col: MergeCol) => void;
  onToggleMergeLeft: (globalIndex: number, col: HMergeCol) => void;
  onToggleOptional: (globalIndex: number) => void;
  /** Toggle the green "mark" highlight on a row (presentational only). */
  onToggleMark: (globalIndex: number) => void;
  /**
   * Reorder a section row up (-1) or down (+1) within its system group
   * by swapping it with the adjacent sibling. Section rows have no
   * printed `no`, so they aren't addressable by the standard "jump to
   * No" input — these arrows are their dedicated reorder UI.
   */
  onMoveSection: (globalIndex: number, dir: -1 | 1) => void;
  /**
   * Reorder a row inside its system group via drag-and-drop. Both indices
   * are into the live `items` array; the parent rejects cross-group drops
   * so the table can't accidentally interleave two systems.
   */
  onMoveRow: (fromGlobal: number, toGlobal: number) => void;
  onRenameExtraColumn: (id: string, label: string) => void;
  onRemoveExtraColumn: (id: string) => void;
  /**
   * Called from the 📋 "Paste column" button in each editable column
   * header. Reads the system clipboard and fills the column down from
   * row 1 of the target system page, preserving multi-line cell content
   * exactly as Excel had it.
   */
  onPasteColumn: (system: string, colKey: string) => Promise<void> | void;
}) {
  // ── Drag-and-drop reorder state ────────────────────────────────────
  // `dragGlobalIndex` is the live items[] index of the row currently
  // being dragged from its "≡" handle. `dropTargetIndex` is the row
  // we're hovering over (also a live items[] index) so we can render a
  // thin red insertion bar without re-painting the whole table on every
  // mousemove. Both live inside SystemTable so each system page tracks
  // its own drag independently; HTML5 drag events fire on the source's
  // <tr> too, so this scope is sufficient.
  const [dragGlobalIndex, setDragGlobalIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  // In-app note editor (replaces the old browser prompt). Holds the row being
  // annotated and the working text.
  const [noteEditIndex, setNoteEditIndex] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  // Controlled per-row actions menu (was a native <details>, which never
  // closed on an outside click and — worse — kept its DOM-managed open state
  // on the row that slid into place after a "Remove row", so a deleted row's
  // menu appeared stuck open). `openRowMenu` is the live items[] index whose
  // menu is showing (only one at a time); the ref wraps the open trigger+menu
  // so an outside click / Escape can dismiss it.
  const [openRowMenu, setOpenRowMenu] = useState<number | null>(null);
  const rowMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (openRowMenu === null) return;
    const onDown = (e: MouseEvent) => {
      // Clicks on the trigger or inside the menu are handled by their own
      // onClick; only a click outside closes.
      if (rowMenuRef.current?.contains(e.target as Node)) return;
      setOpenRowMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenRowMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openRowMenu]);
  // Base = No, Brand, Model, Description, [Picture], Quantity, Delivery,
  // Unit Price, Total Price — plus one cell per manual column. In BoQ
  // mode the two pricing columns (Unit Price, Total Price) drop out, so
  // the total column count shrinks by 2.
  const pricingCols = boqMode ? 0 : 2;
  const colCount = (showPictures ? 7 : 6) + pricingCols + extraColumns.length;
  // Pull out the items in their group order once so every downstream
  // calculation can resolve merged unit-price cells via effectiveMergedValue.
  const groupItems = group.rows.map((r) => r.item);
  const subtotal = group.rows.reduce((acc, _, rowIdx) => {
    // Section rows are full-width banners with no price/quantity, and
    // optional rows are shown to the client for reference only — both
    // must stay out of the subtotal the same way they stay out of the
    // grand total in computeQuotationTotals.
    if (isSectionRow(groupItems[rowIdx])) return acc;
    if (groupItems[rowIdx].optional) return acc;
    const qty = Number(groupItems[rowIdx].quantity) || 0;
    const price =
      Number(effectiveMergedValue(groupItems, rowIdx, "unit_price")) || 0;
    return acc + qty * price;
  }, 0);
  // Column width budget — every visible column gets a hard percentage and
  // the whole row MUST sum to exactly 100 so `table-layout: fixed` lays
  // the table out flush with the page edges. Description absorbs whatever
  // the optional/manual columns don't take, so the table always fits on A4
  // without horizontal overflow regardless of which columns are showing.
  const fixedSum =
    4 + 10 + 12 + 6 + 8 // No + Brand + Model + Quantity + Delivery
    + (showPictures ? 10 : 0) // Picture
    + (boqMode ? 0 : 22); // Unit Price (10) + Total Price (12)
  const extraTotalWidth = Math.min(extraColumns.length * 7, 21);
  const extraShare =
    extraColumns.length > 0 ? extraTotalWidth / extraColumns.length : 0;
  const descWidth = 100 - fixedSum - extraTotalWidth;

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
        {editable && rowSpan > 1 && (
          <button
            type="button"
            onClick={() => onUnmergeCell(globalIndex, col)}
            title="Unmerge this cell from the rows below"
            className="no-print absolute top-0 right-0 w-4 h-4 text-[9px] leading-none rounded-bl bg-magic-red text-white"
          >
            ⇩
          </button>
        )}
        {editable && rowIdx > 0 && rowSpan === 1 && (
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

  // Tiny paste-column button shown inside each editable column header.
  // One click reads the system clipboard, parses the first column out of
  // whatever Excel put there, and fills it down this column — preserving
  // any multi-line cell content exactly (a single Excel cell with three
  // lines of text lands in ONE row of the designer, keeping the line
  // breaks). Hidden in the printed sheet via `no-print`.
  const pasteBtn = (colKey: string, columnLabel: string) => {
    if (!editable) return null;
    return (
      <button
        type="button"
        onClick={() => onPasteColumn(group.system, colKey)}
        className="no-print ml-1 inline-flex items-center justify-center w-5 h-5 rounded border border-magic-border bg-white text-magic-ink/70 hover:bg-magic-soft hover:text-magic-red text-[11px] leading-none align-middle"
        title={`Paste an Excel column into ${columnLabel} — one click fills every cell down this column`}
        aria-label={`Paste clipboard column into ${columnLabel}`}
      >
        📋
      </button>
    );
  };

  return (
    <>
    <table>
      <thead>
        <tr>
          <th style={{ width: "4%" }}>No</th>
          <th style={{ width: "10%" }}>
            Brand
            {pasteBtn("brand", "Brand")}
          </th>
          <th style={{ width: "12%" }}>
            Model
            {pasteBtn("model", "Model")}
          </th>
          <th style={{ width: `${descWidth}%` }}>
            Description
            {pasteBtn("description", "Description")}
          </th>
          {showPictures && <th style={{ width: "10%" }}>Picture</th>}
          <th style={{ width: "6%" }}>
            QTY
            {pasteBtn("quantity", "QTY")}
          </th>
          <th style={{ width: "8%" }}>
            Delivery
            {pasteBtn("delivery", "Delivery")}
          </th>
          {!boqMode && (
            <th style={{ width: "10%" }}>
              Unit Price
              {pasteBtn("unit_price", "Unit Price")}
            </th>
          )}
          {!boqMode && <th style={{ width: "12%" }}>Total Price</th>}
          {extraColumns.map((col) => (
            <th key={col.id} style={{ width: `${extraShare}%` }}>
              {editable ? (
                <div className="flex items-center justify-center gap-1">
                  <input
                    className="w-full bg-transparent text-center uppercase font-bold text-magic-red"
                    value={col.label}
                    onChange={(e) => onRenameExtraColumn(col.id, e.target.value)}
                    aria-label="Rename manual column"
                  />
                  {pasteBtn(`extra:${col.id}`, col.label || "Column")}
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
        {(() => {
          // ── Drag-and-drop helpers ────────────────────────────────────────
          // The drag handle on each row's "No" cell uses these to set / clear
          // drag state. Drop targets (the full <tr>) preventDefault on
          // dragover so the browser allows a drop, then on drop the parent's
          // `onMoveRow` shuffles items[] and renumbers in one go.
          //
          // We keep state scoped to this SystemTable, so a drag started in
          // group A only highlights drop slots inside group A — there's no
          // single global cross-group drag state. That mirrors the existing
          // moveRowToNo contract which already refused cross-group jumps.
          const onHandleDragStart =
            (globalIndex: number) => (e: React.DragEvent<HTMLElement>) => {
              if (!editable) return;
              setDragGlobalIndex(globalIndex);
              e.dataTransfer.effectAllowed = "move";
              try {
                // Some browsers refuse to fire dragover without payload.
                e.dataTransfer.setData("text/plain", String(globalIndex));
              } catch {
                /* ignore — Safari quirks */
              }
              // Use the whole row as the ghost so the user sees what's
              // being dragged instead of a tiny "≡" handle floating around.
              const tr = (e.currentTarget as HTMLElement).closest("tr");
              if (tr) {
                try {
                  e.dataTransfer.setDragImage(tr, 12, 12);
                } catch {
                  /* ignore — older Safari */
                }
              }
            };
          const onHandleDragEnd = () => {
            setDragGlobalIndex(null);
            setDropTargetIndex(null);
          };
          const onRowDragOver =
            (globalIndex: number) => (e: React.DragEvent<HTMLTableRowElement>) => {
              if (!editable || dragGlobalIndex == null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dropTargetIndex !== globalIndex) {
                setDropTargetIndex(globalIndex);
              }
            };
          const onRowDragLeave =
            (globalIndex: number) => () => {
              if (dropTargetIndex === globalIndex) setDropTargetIndex(null);
            };
          const onRowDrop =
            (globalIndex: number) => (e: React.DragEvent<HTMLTableRowElement>) => {
              if (!editable || dragGlobalIndex == null) return;
              e.preventDefault();
              const from = dragGlobalIndex;
              setDragGlobalIndex(null);
              setDropTargetIndex(null);
              if (from === globalIndex) return;
              onMoveRow(from, globalIndex);
            };
          const dragHandle = (globalIndex: number) =>
            editable ? (
              <span
                draggable
                onDragStart={onHandleDragStart(globalIndex)}
                onDragEnd={onHandleDragEnd}
                title="Drag to reorder this row within the same page"
                aria-label="Drag to reorder row"
                className="no-print inline-flex h-5 w-4 cursor-grab items-center justify-center select-none text-magic-ink/40 hover:text-magic-red active:cursor-grabbing"
              >
                ≡
              </span>
            ) : null;
          return group.rows.map(({ item, globalIndex }, rowIdx) => {
          if (isSectionRow(item)) {
            // Full-width banner divider. No number, no quantity, no
            // price — pure visual sub-section break inside the system
            // table. Editable: inline label input + small move/delete
            // controls that vanish on print.
            const isDropTarget =
              editable &&
              dragGlobalIndex != null &&
              dropTargetIndex === globalIndex &&
              dragGlobalIndex !== globalIndex;
            const isBeingDragged =
              editable && dragGlobalIndex === globalIndex;
            return (
              <tr
                key={globalIndex}
                className={`section-row ${
                  isDropTarget ? "qt-row-drop-target" : ""
                } ${isBeingDragged ? "qt-row-dragging" : ""}`}
                onDragOver={onRowDragOver(globalIndex)}
                onDragLeave={onRowDragLeave(globalIndex)}
                onDrop={onRowDrop(globalIndex)}
              >
                <td
                  colSpan={colCount}
                  className="bg-magic-soft text-magic-red font-bold uppercase tracking-wide text-[12px] py-2 px-3 text-left"
                >
                  {editable ? (
                    <div className="flex items-center gap-2">
                      {dragHandle(globalIndex)}
                      <span aria-hidden className="opacity-60">§</span>
                      <input
                        className="flex-1 bg-transparent font-bold uppercase tracking-wide text-magic-red placeholder:text-magic-red/40"
                        value={item.section_label || ""}
                        placeholder="Section title (e.g. Outdoor Cameras)"
                        aria-label="Section title"
                        onChange={(e) =>
                          onUpdate(globalIndex, { section_label: e.target.value })
                        }
                      />
                      <div className="no-print flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onMoveSection(globalIndex, -1)}
                          title="Move section up"
                          className="w-5 h-5 text-[10px] leading-none rounded border border-magic-border bg-white text-magic-ink/60 hover:bg-magic-soft"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          onClick={() => onMoveSection(globalIndex, 1)}
                          title="Move section down"
                          className="w-5 h-5 text-[10px] leading-none rounded border border-magic-border bg-white text-magic-ink/60 hover:bg-magic-soft"
                        >
                          ▼
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemove(globalIndex)}
                          title="Remove this section row"
                          className="w-5 h-5 text-[11px] leading-none rounded text-red-500 hover:bg-magic-soft"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span>{item.section_label || ""}</span>
                  )}
                </td>
              </tr>
            );
          }
          const hPlan = computeHRowPlan(item, plan.skip, rowIdx);
          const isDropTarget =
            editable &&
            dragGlobalIndex != null &&
            dropTargetIndex === globalIndex &&
            dragGlobalIndex !== globalIndex;
          const isBeingDragged =
            editable && dragGlobalIndex === globalIndex;
          return (
          <tr
            key={globalIndex}
            className={`${item.marked ? "qt-row-marked" : ""} ${
              isDropTarget ? "qt-row-drop-target" : ""
            } ${isBeingDragged ? "qt-row-dragging" : ""}`.trim()}
            onDragOver={onRowDragOver(globalIndex)}
            onDragLeave={onRowDragLeave(globalIndex)}
            onDrop={onRowDrop(globalIndex)}
          >
            <td>
              {editable ? (
                <div className="flex items-center justify-center gap-1">
                  {dragHandle(globalIndex)}
                  <span className="text-[11px] font-semibold text-magic-ink">
                    {item.no}
                  </span>
                </div>
              ) : (
                <span>{item.no}</span>
              )}
            </td>
            {mergeableCell(
              "brand",
              rowIdx,
              globalIndex,
              hPlan,
              "font-bold cell-center",
              editable ? (
                <input
                  className="cell-input text-center"
                  value={item.brand}
                  onChange={(e) =>
                    onUpdate(globalIndex, { brand: e.target.value })
                  }
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
              "font-semibold cell-center",
              editable ? (
                <input
                  className="cell-input text-center"
                  value={item.model}
                  onChange={(e) =>
                    onUpdate(globalIndex, { model: e.target.value })
                  }
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
                  value={item.description}
                  onChange={(e) =>
                    onUpdate(globalIndex, { description: e.target.value })
                  }
                  placeholder="Add a short description for this item…"
                  className="description-input w-full bg-transparent text-[10.5px]"
                />
              ) : (
                <div className="whitespace-pre-wrap text-left">
                  {item.description && item.description.trim()
                    ? item.description
                    : `${item.brand || ""} ${item.model || ""}`.trim() || "—"}
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
            <td className="relative">
              {editable ? (
                <input
                  type="number"
                  className="cell-input text-center"
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
                  className="cell-input text-center"
                  value={item.delivery}
                  onChange={(e) =>
                    onUpdate(globalIndex, { delivery: e.target.value })
                  }
                />
              ) : (
                item.delivery
              ),
            )}
            {!boqMode &&
              mergeableCell(
                "unit_price",
                rowIdx,
                globalIndex,
                hPlan,
                "",
                editable ? (
                  <input
                    type="number"
                    className="cell-input text-center"
                    value={item.unit_price}
                    onChange={(e) =>
                      onUpdate(globalIndex, { unit_price: Number(e.target.value) })
                    }
                  />
                ) : (
                  renderPriceCell(item.unit_price)
                ),
              )}
            {!boqMode && (
            <td className="font-semibold">
              {item.optional ? (
                <span className="italic text-magic-ink/60">Optional</span>
              ) : (() => {
                const rowTotal =
                  (Number(item.quantity) || 0) *
                  (Number(
                    effectiveMergedValue(groupItems, rowIdx, "unit_price"),
                  ) || 0);
                return renderPriceCell(rowTotal);
              })()}
              {editable && (
                <div className="no-print mt-1 flex items-center justify-center gap-1">
                  {item.note ? (
                    <button
                      type="button"
                      onClick={() => {
                        setNoteDraft(item.note ?? "");
                        setNoteEditIndex(globalIndex);
                      }}
                      title={`Internal note (never printed): ${item.note}`}
                      aria-label="Open this row's internal note"
                      className="text-[11px] leading-none cursor-pointer"
                    >
                      📝
                    </button>
                  ) : null}
                  <div
                    ref={openRowMenu === globalIndex ? rowMenuRef : undefined}
                    className="relative inline-block text-left"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setOpenRowMenu((cur) =>
                          cur === globalIndex ? null : globalIndex,
                        )
                      }
                      className="cursor-pointer select-none inline-flex items-center justify-center w-auto px-1.5 h-4 text-[10px] leading-none rounded bg-white/80 text-magic-ink/60 border border-magic-border hover:bg-magic-soft"
                      title="Row actions"
                      aria-label="Row actions"
                      aria-haspopup="menu"
                      aria-expanded={openRowMenu === globalIndex}
                    >
                      ⋯
                    </button>
                    {openRowMenu === globalIndex && (
                      <div className="absolute right-0 z-30 mt-1 w-44 rounded-md border border-magic-border bg-white py-1 text-left shadow-lg">
                        <div className="px-2 pb-1">
                          <div className="mb-0.5 text-[9px] uppercase tracking-wide text-magic-ink/40">
                            Move to page
                          </div>
                          <Select
                            value=""
                            placeholder="Move to…"
                            onChange={(v) => {
                              setOpenRowMenu(null);
                              if (!v) return;
                              if (v === "__new__") {
                                const name = prompt("Move to which page?", "");
                                if (name && name.trim())
                                  onUpdate(globalIndex, { system: name.trim() });
                              } else {
                                onUpdate(globalIndex, { system: v });
                              }
                            }}
                            className="w-full min-w-0 rounded border border-magic-border bg-white px-1 py-0.5 text-[10px] shadow-none"
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
                          </Select>
                        </div>
                        <div className="my-1 border-t border-magic-border/60" />
                        <button
                          type="button"
                          onClick={() => {
                            onToggleOptional(globalIndex);
                            setOpenRowMenu(null);
                          }}
                          title="Show unit price but exclude this row from the total"
                          className="block w-full px-2 py-1 text-left text-[11px] hover:bg-magic-soft"
                        >
                          {item.optional ? "✓ Optional" : "Mark as optional"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onToggleMark(globalIndex);
                            setOpenRowMenu(null);
                          }}
                          title="Highlight this row in green"
                          className="block w-full px-2 py-1 text-left text-[11px] hover:bg-magic-soft"
                        >
                          {item.marked ? "✓ Highlighted" : "Highlight row"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onDuplicate(globalIndex);
                            setOpenRowMenu(null);
                          }}
                          className="block w-full px-2 py-1 text-left text-[11px] hover:bg-magic-soft"
                        >
                          Duplicate row
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onCopy(globalIndex);
                            setOpenRowMenu(null);
                          }}
                          className="block w-full px-2 py-1 text-left text-[11px] hover:bg-magic-soft"
                        >
                          Copy row
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onPaste(globalIndex);
                            setOpenRowMenu(null);
                          }}
                          className="block w-full px-2 py-1 text-left text-[11px] hover:bg-magic-soft"
                        >
                          Paste row after
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNoteDraft(item.note ?? "");
                            setNoteEditIndex(globalIndex);
                            setOpenRowMenu(null);
                          }}
                          title="Attach an internal note that never prints"
                          className="block w-full px-2 py-1 text-left text-[11px] hover:bg-magic-soft"
                        >
                          {item.note ? "Edit note…" : "Add note…"}
                        </button>
                        <div className="my-1 border-t border-magic-border/60" />
                        <button
                          type="button"
                          onClick={() => {
                            onRemove(globalIndex);
                            setOpenRowMenu(null);
                          }}
                          className="block w-full px-2 py-1 text-left text-[11px] text-red-600 hover:bg-red-50"
                        >
                          Remove row
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </td>
            )}
            {extraColumns.map((col) => {
              const cellValue = item.extra?.[col.id] || "";
              return (
                <td key={col.id} className="align-top relative">
                  {editable ? (
                    <input
                      className="cell-input text-center"
                      value={cellValue}
                      onChange={(e) =>
                        onUpdate(globalIndex, {
                          extra: { ...(item.extra || {}), [col.id]: e.target.value },
                        })
                      }
                    />
                  ) : cellValue ? (
                    cellValue
                  ) : (
                    "—"
                  )}
                </td>
              );
            })}
          </tr>
          );
        });
        })()}
        {!boqMode && (
          <tr className="totals-row">
            <td colSpan={colCount - 1}>{group.system} Subtotal</td>
            <td>{money(subtotal)}</td>
          </tr>
        )}
      </tbody>
    </table>

    {/* In-app note editor — replaces the old browser prompt. A proper panel
        that matches the app: free multi-line writing, blank lines for spacing,
        and typed bullet points (•/-) are all preserved. Internal only — never
        printed or exported. */}
    {noteEditIndex !== null && (
      <div className="no-print fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={() => setNoteEditIndex(null)}
        />
        <div className="relative z-10 w-full max-w-lg rounded-2xl border border-magic-border bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-magic-border px-5 py-3">
            <h3 className="text-sm font-bold text-magic-ink">Internal note</h3>
            <button
              type="button"
              onClick={() => setNoteEditIndex(null)}
              className="rounded-md p-1 text-magic-ink/50 hover:bg-magic-soft"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="px-5 py-4">
            <p className="mb-2 text-[11px] text-magic-ink/50">
              For your team only — this never appears on the printed sheet, PDF
              or Excel export. Write freely: blank lines and bullet points
              (start a line with • or -) are kept.
            </p>
            <textarea
              autoFocus
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={8}
              placeholder={"e.g.\n• Confirm cable route with the client\n• Price assumes existing conduit\n\nNotes, reminders, anything."}
              className="w-full resize-y rounded-lg border border-magic-border px-3 py-2 text-sm leading-relaxed text-magic-ink focus:border-magic-red/40 focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-magic-border px-5 py-3">
            <button
              type="button"
              onClick={() => setNoteEditIndex(null)}
              className="rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdate(noteEditIndex, { note: noteDraft.trim() });
                setNoteEditIndex(null);
              }}
              className="rounded-lg bg-magic-red px-4 py-1.5 text-xs font-semibold text-white hover:bg-magic-red/90"
            >
              Save note
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// ─── Picture cell with manual upload ─────────────────────────────────────────

// Downscales pictures to at most MAX_IMAGE_WIDTH px wide and re-encodes them
// (JPEG for photos, PNG when the source has an alpha channel) so each picture
// stays small enough to fit in the /api/quotations JSON payload even when a
// quotation carries dozens of them across multiple pages. The table cell only
// renders at ~80 px so 800 px is still ~10× oversampled — no visible loss.
const MAX_IMAGE_WIDTH = 800;
const JPEG_QUALITY = 0.7;
// Any existing data URL larger than this gets re-compressed on save. At
// MAX_IMAGE_WIDTH × JPEG_QUALITY a typical photo encodes to 50–120 KB, so
// 180 KB is a generous "already compressed" threshold.
export const REENCODE_THRESHOLD = 180_000;

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Core compressor: takes a data URL, returns a downscaled/re-encoded data URL
// (or the original if it's already small, not an image, or anything fails).
export async function compressDataUrl(dataUrl: string): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith("data:image/")) return dataUrl;

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image decode failed"));
      el.src = dataUrl;
    });

    const needsDownscale = img.naturalWidth > MAX_IMAGE_WIDTH;
    const targetWidth = needsDownscale ? MAX_IMAGE_WIDTH : img.naturalWidth;
    const scale = targetWidth / img.naturalWidth;
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const keepAlpha = dataUrl.startsWith("data:image/png") ||
      dataUrl.startsWith("data:image/webp");
    const out = keepAlpha
      ? canvas.toDataURL("image/png")
      : canvas.toDataURL("image/jpeg", JPEG_QUALITY);

    // Never upsize: if re-encoding produced a larger string (tiny, already
    // highly compressed source), keep the original.
    return out.length < dataUrl.length ? out : dataUrl;
  } catch {
    return dataUrl;
  }
}

async function compressImage(file: File): Promise<string> {
  const original = await readFileAsDataURL(file);
  if (!file.type.startsWith("image/")) return original;
  return compressDataUrl(original);
}

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

  async function onPick(file: File | null) {
    if (!file) return;
    const dataUrl = await compressImage(file);
    onUpdate({ picture_url: dataUrl });
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
  notes = "",
  setNotes,
  presalesEngineer,
}: {
  terms: string[];
  setTerms?: (t: string[]) => void;
  editable: boolean;
  notes?: string;
  setNotes?: (n: string) => void;
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

      {/* Optional Notes — a free-text block under the terms. In the editor it
       * always shows so the user can type into it; on the readonly / printed
       * sheet it only renders when there's actually something to display, so
       * a quotation with no notes prints exactly as before. */}
      {(editable || notes.trim().length > 0) && (
        <div className="mt-3">
          <div className="border-b border-magic-ink/40 inline-block font-bold italic mb-1">
            Notes
          </div>
          {editable ? (
            <textarea
              value={notes}
              onChange={(e) => setNotes?.(e.target.value)}
              placeholder="Optional notes (left blank, this section is hidden on the printed quotation)…"
              className="mt-1 w-full min-h-[3em] resize-y rounded-md border border-dotted border-magic-border bg-transparent px-2 py-1 outline-none focus:border-magic-red"
            />
          ) : (
            <p className="mt-1 whitespace-pre-wrap">{notes}</p>
          )}
        </div>
      )}

      <p className="mt-3 font-bold italic">
        Presales Engineer: {presalesEngineer || "—"}
      </p>
    </div>
  );
}

/**
 * Compact "No" cell that doubles as a jump-to-row input.
 *
 * Click the number (or tab into it) and type a new row number to move
 * the row to that position within its own system group. Pressing Enter
 * or blurring commits; Esc reverts. Replaces the old ▲/▼ arrow pair,
 * which was painfully slow on tables with dozens of rows.
 */
function RowNoJump({
  value,
  min,
  max,
  onJump,
}: {
  value: number;
  min: number;
  max: number;
  onJump: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string>(String(value));
  // Keep the displayed value in sync when rows are renumbered externally
  // (e.g. after a merge, delete, or duplicate elsewhere in the table).
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit() {
    const n = parseInt(draft, 10);
    if (!Number.isFinite(n) || n < 1) {
      setDraft(String(value));
      return;
    }
    if (n === value) {
      setDraft(String(value));
      return;
    }
    onJump(n);
  }

  return (
    <div
      className="inline-flex items-center justify-center gap-1 rounded-md bg-magic-soft/50 px-1.5 py-0.5"
      title={`Type a number ${min}–${max} and press Enter to move this row to that position within its system.`}
    >
      <input
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setDraft(String(value));
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        onBlur={commit}
        className="no-print w-10 rounded-sm border border-magic-border/60 bg-white px-1 text-center text-[10.5px] font-semibold text-magic-ink focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red/40"
        aria-label={`Row number (${min}–${max}) — type a new value to jump`}
      />
      {/* Printed/PDF view should still show the plain number, so keep a
          hidden span that print styles expose. */}
      <span className="hidden print:inline">{value}</span>
    </div>
  );
}
