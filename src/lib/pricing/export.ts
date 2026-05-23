import { calculateRow, calculateTotals, type Constants, type ProductInput, type TotalsRow } from "./calculations";

interface Row extends ProductInput {
  id: number;
  position: number;
}

function N(v: number, decimals = 3) {
  return v.toFixed(decimals);
}

// ─── CSV Export ────────────────────────────────────────────────────────────────

export function exportToCsv(
  rows: Row[],
  constants: Constants,
  projectName: string,
  manufacturerName: string,
  targetCurrency = "JOD",
  responsiblePerson?: string | null
) {
  const calculated = rows.map((r) => ({ ...r, ...calculateRow(r, constants) }));
  const totals = calculateTotals(calculated);
  const cur = targetCurrency;

  const headers = [
    "#",
    "Item Model",
    "USD Price /unit",
    "USD Price Total",
    "Qty",
    `${cur} Price /unit`,
    `${cur} Price Total`,
    "Shipping /unit",
    "Shipping Total",
    "Customs /unit",
    "Customs Total",
    "Landed Cost /unit",
    "Landed Cost Total",
    "Profit /unit",
    "Profit Total",
    "Pre-Tax Price /unit",
    "Pre-Tax Price Total",
    "Tax /unit",
    "Tax Total",
    "Final Price /unit",
    "Final Price Total",
  ];

  const dataRows = calculated.map((row) => [
    row.position,
    `"${row.itemModel.replace(/"/g, '""')}"`,
    N(row.priceUsd),
    N(row.usdTotal),
    row.quantity,
    N(row.jodPrice),
    N(row.jodPriceTotal),
    N(row.shipping),
    N(row.shippingTotal),
    N(row.customs),
    N(row.customsTotal),
    N(row.landedCost),
    N(row.landedCostTotal),
    N(row.profit),
    N(row.profitTotal),
    N(row.preTaxPrice),
    N(row.preTaxPriceTotal),
    N(row.tax),
    N(row.taxTotal),
    N(row.finalPrice),
    N(row.finalPriceTotal),
  ]);

  const totalRow = [
    "",
    "TOTALS",
    "",
    N(totals.usdTotal),
    "",
    "",
    N(totals.jodPriceTotal),
    "",
    N(totals.shippingTotal),
    "",
    N(totals.customsTotal),
    "",
    N(totals.landedCostTotal),
    "",
    N(totals.profitTotal),
    "",
    N(totals.preTaxPriceTotal),
    "",
    N(totals.taxTotal),
    "",
    N(totals.finalPriceTotal),
  ];

  const constantsBlock = [
    [""],
    ["Settings"],
    [`Currency Rate,${constants.currencyRate}`],
    [`Shipping Rate,${(constants.shippingRate * 100).toFixed(2)}%`],
    [`Customs Rate,${(constants.customsRate * 100).toFixed(2)}%`],
    [`Profit Margin,${(constants.profitMargin * 100).toFixed(2)}%`],
    [`Tax Rate,${(constants.taxRate * 100).toFixed(2)}%`],
  ];

  const csvLines = [
    `"${manufacturerName} – ${projectName}"`,
    ...(responsiblePerson ? [`"Responsible: ${responsiblePerson}"`] : []),
    `"Exported: ${new Date().toLocaleString()}"`,
    "",
    headers.join(","),
    ...dataRows.map((r) => r.join(",")),
    totalRow.join(","),
    ...constantsBlock.map((r) => r.join(",")),
  ];

  const csv = csvLines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${manufacturerName}-${projectName}-${new Date().toISOString().slice(0, 10)}.csv`
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "");
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Chart section for print ──────────────────────────────────────────────────

function buildChartsHtml(totals: TotalsRow, cur: string): string {
  const fmt3 = (v: number) =>
    v.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const rev = totals.finalPriceTotal;
  const marginPct = rev > 0 ? ((totals.profitTotal / rev) * 100).toFixed(1) : "0.0";

  // KPI cards
  const kpis = [
    { label: "Total Revenue",      value: `${fmt3(rev)} ${cur}`,                      color: "#0891b2" },
    { label: "Total Landed Cost",  value: `${fmt3(totals.landedCostTotal)} ${cur}`,    color: "#ea580c" },
    { label: "Total Gross Profit", value: `${fmt3(totals.profitTotal)} ${cur}`,         color: "#16a34a" },
    { label: "Net Margin",         value: `${marginPct}%`,                              color: "#7c3aed" },
  ];

  const kpiHtml = kpis
    .map(
      (k) => `
      <div style="flex:1;min-width:130px;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;background:#fff;">
        <div style="font-size:9px;color:#64748b;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.05em;">${k.label}</div>
        <div style="font-size:14px;font-weight:700;color:${k.color};">${k.value}</div>
      </div>`
    )
    .join("");

  // Horizontal stacked composition bar
  const segments = [
    { label: `${cur} Base`, value: totals.jodPriceTotal,  color: "#d97706" },
    { label: "Shipping",     value: totals.shippingTotal,  color: "#2563eb" },
    { label: "Customs",      value: totals.customsTotal,   color: "#7c3aed" },
    { label: "Profit",       value: totals.profitTotal,    color: "#16a34a" },
    { label: "Tax",          value: totals.taxTotal,       color: "#e11d48" },
  ];

  const barSegments = segments
    .map((s) => {
      const pct = rev > 0 ? ((s.value / rev) * 100).toFixed(2) : "0";
      return `<div title="${s.label}: ${fmt3(s.value)} ${cur} (${pct}%)" style="width:${pct}%;background:${s.color};height:100%;"></div>`;
    })
    .join("");

  const legendItems = segments
    .map((s) => {
      const pct = rev > 0 ? ((s.value / rev) * 100).toFixed(1) : "0.0";
      return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:9px;color:#475569;margin-right:10px;">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${s.color};"></span>
          ${s.label} <strong style="color:#1e293b;">${pct}%</strong>
        </span>`;
    })
    .join("");

  return `
  <div class="analysis-section" style="margin-top:18px;page-break-inside:avoid;">
    <div class="section-title">Result Analysis</div>
    <!-- KPI row -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">${kpiHtml}</div>
    <!-- Composition bar -->
    <div style="border:1px solid #e2e8f0;border-radius:8px;background:#fff;padding:10px 14px;">
      <div style="font-size:9px;color:#64748b;margin-bottom:6px;">Revenue composition — how each cost component contributes to final price</div>
      <div style="display:flex;width:100%;height:18px;border-radius:4px;overflow:hidden;margin-bottom:6px;">${barSegments}</div>
      <div>${legendItems}</div>
    </div>
  </div>`;
}

// ─── Print / PDF Export ────────────────────────────────────────────────────────

export function exportToPrint(
  rows: Row[],
  constants: Constants,
  projectName: string,
  manufacturerName: string,
  targetCurrency = "JOD",
  responsiblePerson?: string | null
) {
  const cur = targetCurrency;
  const activeRows = rows.filter((r) => r.priceUsd > 0 && r.itemModel);
  const calculated = rows.map((r) => ({ ...r, ...calculateRow(r, constants) }));
  const totals = calculateTotals(calculated);
  const chartsHtml = activeRows.length > 0 ? buildChartsHtml(totals, cur) : "";

  const fmt = (v: number) =>
    v.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const colGroups = [
    { label: `${cur} Price`, unit: "jodPrice", total: "jodPriceTotal", color: "#d97706" },
    { label: "Shipping", unit: "shipping", total: "shippingTotal", color: "#2563eb" },
    { label: "Customs", unit: "customs", total: "customsTotal", color: "#7c3aed" },
    { label: "Landed Cost", unit: "landedCost", total: "landedCostTotal", color: "#ea580c", highlight: true },
    { label: "Profit", unit: "profit", total: "profitTotal", color: "#059669" },
    { label: "Pre-Tax", unit: "preTaxPrice", total: "preTaxPriceTotal", color: "#0d9488" },
    { label: "Tax", unit: "tax", total: "taxTotal", color: "#e11d48" },
    { label: "Final Price", unit: "finalPrice", total: "finalPriceTotal", color: "#0891b2", highlight: true },
  ];

  const headerCells = colGroups
    .map(
      (c) =>
        `<th colspan="2" class="col-header${c.highlight ? " col-highlight" : ""}" style="color:${c.color};">${c.label}</th>`
    )
    .join("");

  const subHeaderCells = colGroups
    .map(
      () =>
        `<th class="col-sub">/unit</th><th class="col-sub col-sub-r">total</th>`
    )
    .join("");

  const dataRows = calculated
    .map((row, idx) => {
      const cells = colGroups
        .map(
          (c) => `
        <td class="num${c.highlight ? " col-hl" : ""}" style="color:${c.color};">
          ${row.priceUsd ? fmt((row as any)[c.unit]) : "—"}
        </td>
        <td class="num total-cell${c.highlight ? " col-hl" : ""}">
          ${row.priceUsd ? fmt((row as any)[c.total]) : "—"}
        </td>`
        )
        .join("");
      return `<tr class="${idx % 2 === 1 ? "row-alt" : ""}">
        <td class="num center">${row.position}</td>
        <td class="model">${row.itemModel || "—"}</td>
        <td class="num">${fmt(row.priceUsd)}</td>
        <td class="num total-cell">${row.priceUsd ? fmt(row.usdTotal) : "—"}</td>
        <td class="num center">${row.quantity}</td>
        ${cells}
      </tr>`;
    })
    .join("");

  const totalCells = colGroups
    .map(
      (c) => `
    <td class="${c.highlight ? "col-hl" : ""}"></td>
    <td class="num total-cell font-bold${c.highlight ? " col-hl total-highlight" : ""}">
      ${fmt((totals as any)[c.total])}
    </td>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${manufacturerName} – ${projectName}</title>
  <style>
    /* ── Page setup ── */
    @page {
      size: A4 landscape;
      margin: 12mm 10mm 12mm 10mm;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      font-size: 9px;
      color: #1e293b;
      background: #fff;
      width: 100%;
    }

    /* ── Print-specific overrides ── */
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
      .page-break-before { page-break-before: always; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
    }

    /* ── Layout ── */
    .page { padding: 0; width: 100%; }
    .doc-title { font-size: 18px; font-weight: 700; color: #0f172a; }
    .doc-meta { font-size: 9px; color: #94a3b8; line-height: 1.5; text-align: right; }
    .doc-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 2px solid #0891b2; }

    /* ── Section titles ── */
    .section-title {
      font-size: 10px; font-weight: 700; color: #0f172a;
      text-transform: uppercase; letter-spacing: 0.08em;
      margin-bottom: 8px; padding-bottom: 4px;
      border-bottom: 1px solid #cbd5e1;
    }

    /* ── Inputs area (above table) ── */
    .inputs-area { margin-bottom: 14px; }
    .input-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 14px;
    }
    .input-card {
      border: 1px solid #e2e8f0; border-radius: 6px;
      background: #f8fafc; padding: 8px 12px;
    }
    .input-label {
      font-size: 8px; color: #64748b; text-transform: uppercase;
      letter-spacing: 0.06em; margin-bottom: 3px; font-weight: 600;
    }
    .input-value { font-size: 11px; font-weight: 700; color: #0f172a; }
    .factor-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 8px;
    }
    .factor-card {
      border: 1px solid #e2e8f0; border-radius: 6px;
      background: #fff; padding: 8px 12px; text-align: center;
    }
    .factor-label {
      font-size: 8px; color: #64748b; text-transform: uppercase;
      letter-spacing: 0.06em; margin-bottom: 4px; font-weight: 600;
    }
    .factor-value { font-size: 13px; font-weight: 700; color: #0891b2; }
    .factor-note { font-size: 7.5px; color: #94a3b8; margin-top: 2px; }

    /* ── Table ── */
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #e2e8f0; padding: 4px 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    th { background: #f8fafc; font-weight: 600; font-size: 8.5px; text-align: center; color: #64748b; }
    .col-header { font-size: 8.5px; text-align: center; background: #f8fafc; }
    .col-highlight { background: #f1f5f9 !important; }
    .col-sub { font-size: 7.5px; color: #94a3b8; text-align: center; background: #fafafa; }
    .col-sub-r { }
    th:first-child { width: 22px; }
    th.model-col { width: 110px; text-align: left; }
    th.usd-col { width: 54px; }
    th.qty-col { width: 30px; }
    /* Each of the 8 calc columns has 2 sub-cols, keep them compact */
    td, th { font-size: 8.5px; }
    td.num { text-align: right; font-family: "Courier New", monospace; font-size: 8px; }
    td.center { text-align: center; }
    td.model { text-align: left; font-size: 8.5px; color: #1e293b; }
    td.col-hl { background: #fafafa; }
    td.total-cell { color: #64748b; }
    td.total-highlight { color: #0891b2 !important; font-weight: 700; }
    td.font-bold { font-weight: 700; }
    .row-alt td { background: #fafafa; }
    .row-alt td.col-hl { background: #f4f6f8; }

    /* ── Totals row ── */
    tfoot tr { background: #f1f5f9; }
    tfoot td { font-weight: 700; border-top: 2px solid #cbd5e1; }

    /* ── Footer ── */
    .footer { margin-top: 10px; font-size: 8px; color: #94a3b8; text-align: center; }

    /* ── Print button (screen only) ── */
    .print-btn {
      display: inline-flex; align-items: center; gap: 6px;
      background: #0891b2; color: #fff; border: none; border-radius: 8px;
      padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer;
      margin-bottom: 16px;
    }
    .print-btn:hover { background: #0e7490; }
  </style>
</head>
<body>
  <div class="page">
    <button class="print-btn no-print" onclick="window.print()">🖨 Print / Save as PDF</button>

    <div class="doc-head">
      <div>
        <div class="doc-title">${manufacturerName}</div>
      </div>
      <div class="doc-meta">
        Exported: ${new Date().toLocaleString()}<br/>
        ${calculated.length} product line${calculated.length !== 1 ? "s" : ""}
      </div>
    </div>

    <div class="inputs-area">
      <div class="section-title">Project Information</div>
      <div class="input-grid">
        <div class="input-card">
          <div class="input-label">Project</div>
          <div class="input-value">${projectName || "—"}</div>
        </div>
        <div class="input-card">
          <div class="input-label">Manufacturer</div>
          <div class="input-value">${manufacturerName}</div>
        </div>
        <div class="input-card">
          <div class="input-label">Responsible</div>
          <div class="input-value">${responsiblePerson || "—"}</div>
        </div>
        <div class="input-card">
          <div class="input-label">Target Currency</div>
          <div class="input-value">${cur}</div>
        </div>
      </div>

      <div class="section-title">Fixed Factors</div>
      <div class="factor-grid">
        <div class="factor-card">
          <div class="factor-label">Currency Rate</div>
          <div class="factor-value">${constants.currencyRate}</div>
          <div class="factor-note">1 USD → ${cur}</div>
        </div>
        <div class="factor-card">
          <div class="factor-label">Shipping</div>
          <div class="factor-value">${(constants.shippingRate * 100).toFixed(2)}%</div>
          <div class="factor-note">of local price</div>
        </div>
        <div class="factor-card">
          <div class="factor-label">Customs</div>
          <div class="factor-value">${(constants.customsRate * 100).toFixed(2)}%</div>
          <div class="factor-note">of (local + shipping)</div>
        </div>
        <div class="factor-card">
          <div class="factor-label">Profit Margin</div>
          <div class="factor-value">${(constants.profitMargin * 100).toFixed(2)}%</div>
          <div class="factor-note">on landed cost</div>
        </div>
        <div class="factor-card">
          <div class="factor-label">Tax Rate</div>
          <div class="factor-value">${(constants.taxRate * 100).toFixed(2)}%</div>
          <div class="factor-note">on pre-tax price</div>
        </div>
      </div>
    </div>

    <div class="section-title">Product Lines</div>
    <table>
      <colgroup>
        <col style="width:22px">
        <col style="width:110px">
        <col style="width:48px">
        <col style="width:54px">
        <col style="width:28px">
        ${colGroups.map(() => `<col style="width:52px"><col style="width:58px">`).join("")}
      </colgroup>
      <thead>
        <tr>
          <th rowspan="2">#</th>
          <th rowspan="2" class="model-col" style="text-align:left;">Item Model</th>
          <th colspan="2" class="col-header" style="color:#16a34a;">USD Price</th>
          <th rowspan="2" class="qty-col">Qty</th>
          ${headerCells}
        </tr>
        <tr>
          <th class="col-sub">/unit</th>
          <th class="col-sub col-sub-r">total</th>
          ${subHeaderCells}
        </tr>
      </thead>
      <tbody>${dataRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="2" style="text-align:left;font-size:9px;font-weight:700;color:#1e293b;padding:5px 8px;">TOTALS</td>
          <td></td>
          <td class="num total-cell font-bold">${fmt(totals.usdTotal)}</td>
          <td></td>
          ${totalCells}
        </tr>
      </tfoot>
    </table>

    ${chartsHtml}

    <div class="footer">Generated by Pricing Sheet &nbsp;·&nbsp; ${new Date().toLocaleDateString()} &nbsp;·&nbsp; All amounts in ${cur}</div>
  </div>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}
