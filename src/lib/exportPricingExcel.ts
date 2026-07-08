import {
  calculateRow,
  calculateTotals,
  type Constants,
  type ProductInput,
} from "@/lib/pricing/calculations";

/**
 * Everything the pricing-sheet Excel exporter needs. Mirrors the shape the
 * pricing module already computes from `pricing_product_lines` /
 * `pricing_project_constants`, so the folder-sync engine can build the same
 * workbook offline from the sync manifest.
 */
export interface PricingExcelInput {
  projectName: string;
  manufacturerName: string;
  responsiblePerson?: string | null;
  targetCurrency: string;
  constants: Constants;
  rows: Array<ProductInput & { position: number }>;
}

/**
 * Build an .xlsx for one priced project and return it as a Blob — the pricing
 * counterpart of {@link buildQuotationWorkbookBlob}. Columns mirror the
 * pricing module's own CSV export (see src/lib/pricing/export.ts) so the synced
 * workbook shows the same landed-cost → profit → tax → final-price buildup the
 * user sees in the app. Currency label follows the project's target currency.
 *
 * Returns null on the server or when the project has no priced lines.
 */
export async function buildPricingWorkbookBlob(
  input: PricingExcelInput,
): Promise<Blob | null> {
  if (typeof window === "undefined") return null;
  const activeRows = input.rows.filter((r) => r.priceUsd > 0 && r.itemModel);
  if (activeRows.length === 0) return null;

  const ExcelJSmod = (await import("exceljs")) as unknown as {
    Workbook?: new () => import("exceljs").Workbook;
    default?: { Workbook: new () => import("exceljs").Workbook };
  };
  const Workbook = ExcelJSmod.Workbook ?? ExcelJSmod.default?.Workbook;
  if (!Workbook) return null;

  const { constants, targetCurrency: cur } = input;
  const calculated = input.rows.map((r) => ({
    ...r,
    ...calculateRow(r, constants),
  }));
  const totals = calculateTotals(calculated);

  const wb = new Workbook();
  wb.creator = "MagicTech Pricing";
  const ws = wb.addWorksheet("Pricing", {
    views: [{ state: "frozen", ySplit: 5 }],
  });

  const HEADER_FILL = "FF0F172A"; // ink
  const TOTAL_FILL = "FFF1F5F9";
  const white = { color: { argb: "FFFFFFFF" } };

  // ── Title band ────────────────────────────────────────────────────────────
  ws.mergeCells("A1:F1");
  const titleCell = ws.getCell("A1");
  titleCell.value = `${input.manufacturerName} — ${input.projectName}`;
  titleCell.font = { bold: true, size: 14, color: { argb: "FF0F172A" } };

  ws.mergeCells("A2:F2");
  ws.getCell("A2").value = input.responsiblePerson
    ? `Responsible: ${input.responsiblePerson}   ·   Target currency: ${cur}`
    : `Target currency: ${cur}`;
  ws.getCell("A2").font = { size: 10, color: { argb: "FF64748B" } };

  ws.mergeCells("A3:F3");
  ws.getCell("A3").value =
    `Rates — FX ${constants.currencyRate} · shipping ${(constants.shippingRate * 100).toFixed(2)}% · ` +
    `customs ${(constants.customsRate * 100).toFixed(2)}% · profit ${(constants.profitMargin * 100).toFixed(2)}% · ` +
    `tax ${(constants.taxRate * 100).toFixed(2)}%`;
  ws.getCell("A3").font = { size: 9, color: { argb: "FF94A3B8" } };

  // ── Column headers (row 5) ─────────────────────────────────────────────────
  const headers = [
    "#",
    "Item Model",
    "USD /unit",
    "USD Total",
    "Qty",
    `${cur} /unit`,
    `${cur} Total`,
    "Shipping /unit",
    "Shipping Total",
    "Customs /unit",
    "Customs Total",
    "Landed /unit",
    "Landed Total",
    "Profit /unit",
    "Profit Total",
    "Pre-Tax /unit",
    "Pre-Tax Total",
    "Tax /unit",
    "Tax Total",
    "Final /unit",
    "Final Total",
  ];
  const headerRow = ws.getRow(5);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 9, ...white };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL },
    };
    cell.alignment = { horizontal: i <= 1 ? "left" : "right" };
  });

  // ── Data rows ──────────────────────────────────────────────────────────────
  const round = (v: number) => Math.round(v * 1000) / 1000;
  for (const row of calculated) {
    const values = row.priceUsd
      ? [
          row.position,
          row.itemModel || "—",
          round(row.priceUsd),
          round(row.usdTotal),
          row.quantity,
          round(row.jodPrice),
          round(row.jodPriceTotal),
          round(row.shipping),
          round(row.shippingTotal),
          round(row.customs),
          round(row.customsTotal),
          round(row.landedCost),
          round(row.landedCostTotal),
          round(row.profit),
          round(row.profitTotal),
          round(row.preTaxPrice),
          round(row.preTaxPriceTotal),
          round(row.tax),
          round(row.taxTotal),
          round(row.finalPrice),
          round(row.finalPriceTotal),
        ]
      : [row.position, row.itemModel || "—"];
    const added = ws.addRow(values);
    for (let col = 3; col <= headers.length; col++) {
      added.getCell(col).numFmt = "#,##0.000";
    }
  }

  // ── Totals row ──────────────────────────────────────────────────────────────
  const totalRow = ws.addRow([
    "",
    "TOTALS",
    "",
    round(totals.usdTotal),
    "",
    "",
    round(totals.jodPriceTotal),
    "",
    round(totals.shippingTotal),
    "",
    round(totals.customsTotal),
    "",
    round(totals.landedCostTotal),
    "",
    round(totals.profitTotal),
    "",
    round(totals.preTaxPriceTotal),
    "",
    round(totals.taxTotal),
    "",
    round(totals.finalPriceTotal),
  ]);
  for (let col = 1; col <= headers.length; col++) {
    const cell = totalRow.getCell(col);
    cell.font = { bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: TOTAL_FILL },
    };
    if (col > 2) cell.numFmt = "#,##0.000";
  }

  ws.getColumn(2).width = 28;
  for (let c = 3; c <= headers.length; c++) ws.getColumn(c).width = 13;

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
