import { calculateRow, calculateTotals, type Constants, type ProductInput } from "./calculations";
import { analyzePricing } from "./analysis";

interface Row extends ProductInput {
  id: number;
  position: number;
}

function N(v: number, decimals = 3) {
  return v.toFixed(decimals);
}

// ── Restrained report palette (matches PricingCharts) ────────────────────────
// Costs on a cool-grey ramp; profit is the one teal accent; tax a muted ochre;
// revenue is ink. No rainbow.
const P = {
  ink: "#0f172a",
  accent: "#0d9488",
  tax: "#b45309",
  base: "#475569",
  ship: "#7c8ba1",
  customs: "#b0bccd",
  landed: "#1e293b",
  preTax: "#64748b",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function buildChartsHtml(rows: Row[], constants: Constants, cur: string): string {
  const a = analyzePricing(rows, constants);
  if (!a) return "";
  const fmt3 = (v: number) =>
    v.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  // KPI cards — restrained: profit / margin carry the single accent.
  const kpis = [
    { label: "Total Revenue", value: `${fmt3(a.revenue)} ${cur}`, color: P.ink },
    { label: "Total Landed Cost", value: `${fmt3(a.landedCost)} ${cur}`, color: P.landed },
    { label: "Total Gross Profit", value: `${fmt3(a.profit)} ${cur}`, color: P.accent },
    { label: "Net Margin", value: `${a.marginPct.toFixed(1)}%`, color: P.accent },
  ];
  const kpiHtml = kpis
    .map(
      (k) => `
      <div style="flex:1;min-width:130px;border:1px solid #e2e8f0;border-left:3px solid ${k.color};border-radius:6px;padding:10px 14px;background:#fff;">
        <div style="font-size:8.5px;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.08em;">${k.label}</div>
        <div style="font-size:15px;font-weight:700;color:${k.color};font-family:ui-monospace,'Courier New',monospace;">${k.value}</div>
      </div>`,
    )
    .join("");

  // Composition bar (greyscale costs + teal profit + ochre tax).
  const segments = [
    { label: `${cur} Base`, value: a.jodBase, color: P.base },
    { label: "Shipping", value: a.shipping, color: P.ship },
    { label: "Customs", value: a.customs, color: P.customs },
    { label: "Profit", value: a.profit, color: P.accent },
    { label: "Tax", value: a.tax, color: P.tax },
  ];
  const barSegments = segments
    .map((s) => {
      const pct = a.revenue > 0 ? ((s.value / a.revenue) * 100).toFixed(2) : "0";
      return `<div title="${s.label}: ${fmt3(s.value)} ${cur} (${pct}%)" style="width:${pct}%;background:${s.color};height:100%;"></div>`;
    })
    .join("");
  const legendItems = segments
    .map((s) => {
      const pct = a.revenue > 0 ? ((s.value / a.revenue) * 100).toFixed(1) : "0.0";
      return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:9px;color:#475569;margin-right:12px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${s.color};"></span>
          ${s.label} <strong style="color:#1e293b;font-family:ui-monospace,monospace;">${pct}%</strong>
        </span>`;
    })
    .join("");

  // Key ratios.
  const ratios = [
    { expr: "π ⁄ C", value: `${a.markupPct.toFixed(2)}%`, hint: "markup on cost" },
    { expr: "C ⁄ R", value: `${a.costRatioPct.toFixed(2)}%`, hint: "cost ratio" },
    { expr: "T ⁄ pretax", value: `${a.effTaxPct.toFixed(2)}%`, hint: "effective tax" },
    { expr: "R ⁄ n", value: fmt3(a.avgUnitRevenue), hint: "avg unit revenue" },
    { expr: "top₂", value: `${a.top2Pct.toFixed(1)}%`, hint: "revenue in top 2" },
  ];
  const ratioHtml = ratios
    .map(
      (r) => `
      <div style="flex:1;min-width:90px;padding:0 10px;border-left:1px solid #eef2f7;">
        <div style="font-size:8.5px;color:#94a3b8;font-family:ui-monospace,monospace;">${r.expr}</div>
        <div style="font-size:12px;font-weight:700;color:#1e293b;font-family:ui-monospace,monospace;">${r.value}</div>
        <div style="font-size:7.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;">${r.hint}</div>
      </div>`,
    )
    .join("");

  // Written commentary.
  const commentaryHtml = a.insights
    .map(
      (t) =>
        `<li style="margin-bottom:5px;padding-left:12px;position:relative;line-height:1.5;">
          <span style="position:absolute;left:0;top:6px;width:4px;height:4px;border-radius:50%;background:${P.accent};"></span>
          ${esc(t)}
        </li>`,
    )
    .join("");

  // Revenue concentration (Pareto table).
  const paretoRows = a.contributions
    .map(
      (c, i) => `
      <tr${i % 2 ? ' style="background:#fafafa;"' : ""}>
        <td style="padding:3px 6px;border:1px solid #eef2f7;">${esc(c.name)}</td>
        <td style="padding:3px 6px;border:1px solid #eef2f7;text-align:right;font-family:ui-monospace,monospace;">${fmt3(c.revenue)}</td>
        <td style="padding:3px 6px;border:1px solid #eef2f7;text-align:right;font-family:ui-monospace,monospace;color:#64748b;">${c.sharePct.toFixed(1)}%</td>
        <td style="padding:3px 6px;border:1px solid #eef2f7;text-align:right;font-family:ui-monospace,monospace;color:${P.accent};">${c.cumulativePct.toFixed(1)}%</td>
      </tr>`,
    )
    .join("");

  return `
  <div class="analysis-section" style="margin-top:18px;">
    <div class="section-title">Result Analysis</div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">${kpiHtml}</div>

    <div style="border:1px solid #e2e8f0;border-radius:6px;background:#fff;padding:10px 14px;margin-bottom:10px;page-break-inside:avoid;">
      <div style="font-size:9px;color:#64748b;margin-bottom:6px;">Revenue composition — share of each component in final revenue</div>
      <div style="display:flex;width:100%;height:16px;border-radius:3px;overflow:hidden;margin-bottom:6px;">${barSegments}</div>
      <div>${legendItems}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px 0;margin-top:10px;padding-top:8px;border-top:1px solid #f1f5f9;">${ratioHtml}</div>
    </div>

    <div style="display:flex;gap:10px;align-items:flex-start;page-break-inside:avoid;">
      <div style="flex:1.6;border:1px solid #e2e8f0;border-radius:6px;background:#fff;padding:10px 14px;">
        <div style="font-size:9px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Analysis &amp; Commentary</div>
        <ul style="list-style:none;font-size:9.5px;color:#334155;">${commentaryHtml}</ul>
      </div>
      <div style="flex:1;border:1px solid #e2e8f0;border-radius:6px;background:#fff;padding:10px 14px;">
        <div style="font-size:9px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Revenue Concentration</div>
        <table style="width:100%;border-collapse:collapse;font-size:8.5px;">
          <thead>
            <tr style="color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;font-size:7.5px;">
              <th style="padding:3px 6px;text-align:left;border:1px solid #eef2f7;">Item</th>
              <th style="padding:3px 6px;text-align:right;border:1px solid #eef2f7;">${cur}</th>
              <th style="padding:3px 6px;text-align:right;border:1px solid #eef2f7;">% R</th>
              <th style="padding:3px 6px;text-align:right;border:1px solid #eef2f7;">Σ %</th>
            </tr>
          </thead>
          <tbody>${paretoRows}</tbody>
        </table>
      </div>
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
  const chartsHtml = activeRows.length > 0 ? buildChartsHtml(rows, constants, cur) : "";

  const fmt = (v: number) =>
    v.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const colGroups = [
    { label: `${cur} Price`, unit: "jodPrice", total: "jodPriceTotal", color: P.base },
    { label: "Shipping", unit: "shipping", total: "shippingTotal", color: P.ship },
    { label: "Customs", unit: "customs", total: "customsTotal", color: P.customs },
    { label: "Landed Cost", unit: "landedCost", total: "landedCostTotal", color: P.landed, highlight: true },
    { label: "Profit", unit: "profit", total: "profitTotal", color: P.accent },
    { label: "Pre-Tax", unit: "preTaxPrice", total: "preTaxPriceTotal", color: P.preTax },
    { label: "Tax", unit: "tax", total: "taxTotal", color: P.tax },
    { label: "Final Price", unit: "finalPrice", total: "finalPriceTotal", color: P.ink, highlight: true },
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
    .doc-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 2px solid #0d9488; }

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
    .factor-value { font-size: 13px; font-weight: 700; color: #0d9488; }
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
    td.total-highlight { color: #0f172a !important; font-weight: 700; }
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
      background: #0d9488; color: #fff; border: none; border-radius: 8px;
      padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer;
      margin-bottom: 16px;
    }
    .print-btn:hover { background: #0f766e; }
  </style>
</head>
<body>
  <div class="page">
    <button class="print-btn no-print" onclick="window.print()">Print / Save as PDF</button>

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
          <th colspan="2" class="col-header" style="color:#64748b;">USD Price</th>
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
