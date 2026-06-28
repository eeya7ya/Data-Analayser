import type {
  QuotationItem,
  QuotationExtraColumn,
} from "@/components/QuotationPreview";
import { computeQuotationTotals } from "@/lib/quotationTotals";

/**
 * Everything the Excel exporter needs from a quotation. Both the Designer
 * (edit screen) and the read-only QuotationViewer build this shape from
 * their own state / loaded row, so the workbook is produced by one code
 * path and stays identical wherever "Export as Excel" is offered.
 */
export interface QuotationExcelInput {
  items: QuotationItem[];
  extraColumns: QuotationExtraColumn[];
  refCode: string;
  projectName: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  /** Presales / design engineer. */
  designEng?: string;
  salesEng?: string;
  salesPhone?: string;
  preparedBy?: string;
  terms?: string[];
  includeTax: boolean;
  taxPercent: number;
  taxInclusive?: boolean;
  discountMode: "percent" | "amount";
  discountPercent: number;
  discountAmount: number;
}

/**
 * Build a brand-matched .xlsx from a quotation and trigger a download.
 *
 * Uses ExcelJS (dynamically imported so it stays out of the main bundle) to
 * embed the MagicTech logo and mirror the PDF styling — header fills, gold
 * subtotals, a highlighted grand total, borders, per-system tables, terms,
 * and a frozen logo/info band. Currency is JOD throughout.
 *
 * No-ops on the server or when there are no items.
 */
export async function exportQuotationExcel(
  input: QuotationExcelInput,
): Promise<void> {
  if (typeof window === "undefined" || input.items.length === 0) return;

  const ExcelJSmod = (await import("exceljs")) as unknown as {
    Workbook?: new () => import("exceljs").Workbook;
    default?: { Workbook: new () => import("exceljs").Workbook };
  };
  const Workbook = ExcelJSmod.Workbook ?? ExcelJSmod.default?.Workbook;
  if (!Workbook) return;

  const { items, extraColumns: extraCols } = input;
  const itemColumnTitles = [
    "No",
    "Brand",
    "Model",
    "Description",
    "Qty",
    "Delivery",
    "Unit Price",
    "Total Price",
    ...extraCols.map((c) => c.label),
  ];
  const totalCols = itemColumnTitles.length;

  const totals = computeQuotationTotals(
    items,
    input.includeTax ? input.taxPercent : 0,
    input.includeTax && (input.taxInclusive ?? false),
    {
      mode: input.discountMode,
      percent: input.discountPercent,
      amount: input.discountAmount,
    },
  );
  const currencyFmt = '"JOD" #,##0.00##';

  // Brand palette (ARGB) — pulled from the PDF's CSS variables.
  const C = {
    header: "FFE3DDD7",
    red: "FFE2231A",
    ink: "FF2B2F30",
    gold: "FFE3D4A8",
    grand: "FFFFF8BF",
    border: "FFCFBEBC",
  };
  const bd = { style: "thin" as const, color: { argb: C.border } };
  const allBorders = { top: bd, left: bd, bottom: bd, right: bd };
  const fillOf = (argb: string) =>
    ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });

  const wb = new Workbook();
  const ws = wb.addWorksheet("Quotation");
  const widths = [5, 14, 16, 44, 7, 12, 16, 18];
  ws.columns = itemColumnTitles.map((_, i) => ({ width: widths[i] ?? 14 }));

  // ── Logo (floats over the top three rows, roughly centred) ─────────
  ws.getRow(1).height = 20;
  ws.getRow(2).height = 20;
  ws.getRow(3).height = 20;
  try {
    const res = await fetch("/logo.png");
    if (res.ok) {
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const imgId = wb.addImage({ base64: btoa(bin), extension: "png" });
      ws.addImage(imgId, {
        tl: { col: Math.max(0, totalCols / 2 - 0.6), row: 0.15 },
        ext: { width: 175, height: 50 },
      });
    }
  } catch {
    /* logo is optional */
  }

  let r = 4; // first writable row below the logo band

  // ── Info block (label / value pairs, two per row) ──────────────────
  const info: Array<[string, string]> = [];
  info.push(["Reference", input.refCode || ""]);
  info.push(["Date", new Date().toLocaleDateString("en-GB")]);
  info.push(["Project", input.projectName || ""]);
  if (input.clientName) info.push(["Client", input.clientName]);
  if (input.clientEmail) info.push(["Email", input.clientEmail]);
  if (input.clientPhone) info.push(["Phone", input.clientPhone]);
  if (input.designEng) info.push(["Presales Engineer", input.designEng]);
  if (input.salesEng) info.push(["Sales Engineer", input.salesEng]);
  if (input.salesPhone) info.push(["Sales Phone", input.salesPhone]);
  // Prepared By is intentionally NOT here — it goes at the very end, after
  // the Terms & Conditions, matching the printed layout.

  const mid = totalCols >= 8 ? Math.floor(totalCols / 2) : 2;
  for (let i = 0; i < info.length; i += 2) {
    const row = ws.getRow(r);
    const left = info[i];
    const right = info[i + 1];
    const lLabel = row.getCell(1);
    lLabel.value = `${left[0]}:`;
    lLabel.font = { bold: true, color: { argb: C.red }, size: 10 };
    const lVal = row.getCell(2);
    lVal.value = left[1];
    lVal.font = { color: { argb: C.ink }, size: 10 };
    if (mid - 1 > 2) ws.mergeCells(r, 2, r, mid - 1);
    if (right) {
      const rLabel = row.getCell(mid + 1);
      rLabel.value = `${right[0]}:`;
      rLabel.font = { bold: true, color: { argb: C.red }, size: 10 };
      const rVal = row.getCell(mid + 2);
      rVal.value = right[1];
      rVal.font = { color: { argb: C.ink }, size: 10 };
      if (totalCols > mid + 2) ws.mergeCells(r, mid + 2, r, totalCols);
    }
    r++;
  }
  const freezeAt = r; // freeze the logo + info band
  r++; // blank separator

  // ── Per-system tables ──────────────────────────────────────────────
  const groups = (() => {
    const order: string[] = [];
    const map = new Map<string, QuotationItem[]>();
    for (const it of items) {
      const key = it.system || it.brand || "General";
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(it);
    }
    return order.map((k) => ({ system: k, rows: map.get(k)! }));
  })();

  const banner = (text: string) => {
    const row = ws.getRow(r);
    const cell = row.getCell(1);
    cell.value = text;
    cell.font = { bold: true, color: { argb: C.red }, size: 11 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    ws.mergeCells(r, 1, r, totalCols);
    for (let cc = 1; cc <= totalCols; cc++) {
      const c = row.getCell(cc);
      c.fill = fillOf(C.header);
      c.border = allBorders;
    }
    row.height = 18;
    r++;
  };

  const moneyRow = (
    label: string,
    value: number,
    fillArgb: string,
    strong = false,
  ) => {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    ws.mergeCells(r, 1, r, totalCols - 1);
    const valCell = row.getCell(totalCols);
    valCell.value = value;
    valCell.numFmt = currencyFmt;
    for (let cc = 1; cc <= totalCols; cc++) {
      const c = row.getCell(cc);
      c.fill = fillOf(fillArgb);
      c.font = {
        bold: true,
        color: { argb: strong ? C.red : C.ink },
        size: strong ? 11 : 10,
      };
      c.border = allBorders;
      c.alignment = {
        horizontal: cc === 1 ? "right" : "center",
        vertical: "middle",
      };
    }
    r++;
  };

  for (const group of groups) {
    banner(group.system);

    // Column header row
    const headRow = ws.getRow(r);
    itemColumnTitles.forEach((t, i) => {
      const c = headRow.getCell(i + 1);
      c.value = t.toUpperCase();
      c.font = { bold: true, color: { argb: C.red }, size: 9 };
      c.fill = fillOf(C.header);
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = allBorders;
    });
    headRow.height = 18;
    r++;

    let groupSubtotal = 0;
    group.rows.forEach((item, localIdx) => {
      const qty = Number(item.quantity) || 0;
      const unit = Number(item.unit_price) || 0;
      const rowTotal = item.optional ? 0 : qty * unit;
      groupSubtotal += rowTotal;
      const values: (string | number)[] = [
        localIdx + 1,
        item.brand || "",
        item.model || "",
        item.description || "",
        qty,
        item.delivery || "",
        unit,
        item.optional ? "Optional" : rowTotal,
        ...extraCols.map((c) => item.extra?.[c.id] ?? ""),
      ];
      const row = ws.getRow(r);
      values.forEach((v, i) => {
        const c = row.getCell(i + 1);
        c.value = v;
        c.font = { color: { argb: C.ink }, size: 9 };
        c.alignment = {
          horizontal: i === 3 ? "left" : "center",
          vertical: "middle",
          wrapText: i === 3,
        };
        c.border = allBorders;
      });
      row.getCell(7).numFmt = currencyFmt;
      if (!item.optional) row.getCell(8).numFmt = currencyFmt;
      r++;
    });

    moneyRow(`${group.system} Subtotal`, groupSubtotal, C.gold);
    r++; // blank separator between system blocks
  }

  // ── Final Totals ───────────────────────────────────────────────────
  banner("Final Totals");
  moneyRow("Grand Total Cost (Subtotal)", totals.subtotal, C.gold);
  if (totals.discount > 0) {
    const discountLabel =
      input.discountMode === "percent" && input.discountPercent > 0
        ? `Discount (${input.discountPercent}%)`
        : "Discount";
    moneyRow(discountLabel, -totals.discount, C.gold);
    if (input.includeTax) moneyRow("Net After Discount", totals.net, C.gold);
  }
  if (input.includeTax) moneyRow(`TAX (${input.taxPercent}%)`, totals.tax, C.gold);
  moneyRow("Total Cost", totals.total, C.grand, true);

  // ── Terms & Conditions ─────────────────────────────────────────────
  const termsList = (input.terms ?? []).filter((t) => t && t.trim());
  if (termsList.length > 0) {
    r++; // blank
    banner("Terms & Conditions");
    const approxCharsPerLine = widths
      .slice(0, totalCols)
      .reduce((a, b) => a + (b ?? 14), 0);
    termsList.forEach((t, i) => {
      const row = ws.getRow(r);
      const cell = row.getCell(1);
      cell.value = `${i + 1}. ${t}`;
      cell.font = { color: { argb: C.ink }, size: 9 };
      cell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
      ws.mergeCells(r, 1, r, totalCols);
      const lines = Math.max(1, Math.ceil((t.length + 4) / approxCharsPerLine));
      row.height = lines * 14;
      r++;
    });
  }

  // ── Prepared by — at the very end ──────────────────────────────────
  if (input.preparedBy) {
    r++; // blank
    const row = ws.getRow(r);
    const cell = row.getCell(1);
    cell.value = `Prepared by: ${input.preparedBy}`;
    cell.font = { bold: true, color: { argb: C.ink }, size: 10 };
    ws.mergeCells(r, 1, r, totalCols);
    r++;
  }

  ws.views = [{ state: "frozen", ySplit: freezeAt, showGridLines: false }];

  // ── Download ───────────────────────────────────────────────────────
  const out = await wb.xlsx.writeBuffer();
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${input.refCode || input.projectName || "quotation"}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
