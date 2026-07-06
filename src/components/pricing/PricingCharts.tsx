"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LabelList,
  ReferenceLine,
} from "recharts";
import {
  calculateRow,
  calculateTotals,
  type Constants,
  type ProductInput,
} from "@/lib/pricing/calculations";

interface Row extends ProductInput {
  position: number;
}

interface Props {
  rows: Row[];
  constants: Constants;
}

const COLORS = {
  jodPrice: "#f59e0b",
  shipping: "#3b82f6",
  customs: "#8b5cf6",
  landedCost: "#f97316",
  profit: "#22c55e",
  tax: "#ef4444",
  finalPrice: "#0891b2",
};

function fmtJod(v: number) {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function fmtShort(v: number) {
  if (v >= 1000) return (v / 1000).toFixed(1) + "k";
  return v.toFixed(0);
}

function pct(part: number, whole: number) {
  return whole > 0 ? (part / whole) * 100 : 0;
}

// ── KPI card ─────────────────────────────────────────────────────────────────
// A quantity is presented like a variable in a worksheet: a single-letter
// symbol, the value in tabular monospace, and the defining formula beneath.
function KpiCard({
  label,
  symbol,
  value,
  formula,
  color,
}: {
  label: string;
  symbol: string;
  value: string;
  formula: string;
  color: string;
}) {
  return (
    <div
      className="rounded-xl border border-gray-200 bg-white p-4"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
          {label}
        </p>
        <span
          className="font-mono text-sm italic font-semibold"
          style={{ color }}
        >
          {symbol}
        </span>
      </div>
      <p
        className="mt-1.5 font-mono text-xl font-bold leading-none tabular-nums"
        style={{ color }}
      >
        {value}
      </p>
      <p className="mt-1.5 font-mono text-[10.5px] leading-tight text-gray-400">
        {formula}
      </p>
    </div>
  );
}

// ── Derived ratio chip ────────────────────────────────────────────────────────
function RatioStat({
  expr,
  value,
  hint,
}: {
  expr: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-l border-gray-100 px-3 first:border-l-0 first:pl-0">
      <span className="font-mono text-[10px] text-gray-400">{expr}</span>
      <span className="font-mono text-sm font-semibold tabular-nums text-gray-800">
        {value}
      </span>
      <span className="text-[9.5px] uppercase tracking-wider text-gray-400">
        {hint}
      </span>
    </div>
  );
}

// ── Waterfall tooltip ─────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WaterfallTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = payload.find((e: any) => e.dataKey === "value");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = payload.find((e: any) => e.dataKey === "base");
  if (!entry) return null;
  const cumulative = (base?.value ?? 0) + entry.value;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-xl">
      <p className="mb-2 border-b border-gray-100 pb-1 font-mono font-semibold text-gray-800">
        {label}
      </p>
      <div className="flex items-center justify-between gap-6 py-0.5">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: entry.color }}
          />
          <span className="text-gray-500">Δ this step</span>
        </span>
        <span className="font-mono font-semibold text-gray-800">
          {fmtJod(entry.value)}
        </span>
      </div>
      {(base?.value ?? 0) > 0 && (
        <div className="mt-0.5 flex items-center justify-between gap-6 border-t border-gray-100 py-0.5 pt-1">
          <span className="text-gray-400">Σ cumulative</span>
          <span className="font-mono text-gray-600">{fmtJod(cumulative)}</span>
        </div>
      )}
    </div>
  );
};

// ── Donut center label ────────────────────────────────────────────────────────
const DonutCenterLabel = ({
  cx,
  cy,
  total,
}: {
  cx: number;
  cy: number;
  total: number;
}) => (
  <g>
    <text x={cx} y={cy - 8} textAnchor="middle" fill="#94a3b8" fontSize={10}>
      Σ Revenue
    </text>
    <text
      x={cx}
      y={cy + 11}
      textAnchor="middle"
      fill="#1e293b"
      fontSize={14}
      fontWeight={700}
      style={{ fontFamily: "ui-monospace, monospace" }}
    >
      {fmtShort(total)}
    </text>
    <text x={cx} y={cy + 24} textAnchor="middle" fill="#94a3b8" fontSize={9}>
      JOD
    </text>
  </g>
);

// ── Donut percent label ───────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderDonutLabel = ({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}: any) => {
  if (percent < 0.06) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      fill="#fff"
      fontSize={10}
      fontWeight={600}
      style={{ fontFamily: "ui-monospace, monospace" }}
    >
      {`${(percent * 100).toFixed(1)}%`}
    </text>
  );
};

// ── Numeric breakdown row ─────────────────────────────────────────────────────
function BreakdownRow({
  label,
  color,
  amount,
  share,
  strong,
}: {
  label: string;
  color: string;
  amount: number;
  share: number;
  strong?: boolean;
}) {
  return (
    <tr className={strong ? "border-t border-gray-200 font-semibold" : ""}>
      <td className="py-1.5 pr-2">
        <span className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: color }}
          />
          <span className="text-gray-700">{label}</span>
        </span>
      </td>
      <td className="py-1.5 text-right font-mono tabular-nums text-gray-800">
        {fmtJod(amount)}
      </td>
      <td className="py-1.5 pl-2 text-right font-mono tabular-nums text-gray-500">
        {share.toFixed(1)}%
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function PricingCharts({ rows, constants }: Props) {
  const activeRows = rows.filter((r) => r.priceUsd > 0 && r.itemModel);

  if (activeRows.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-gray-200 text-sm text-gray-400">
        Enter product data above to see the quantitative analysis
      </div>
    );
  }

  const calculated = activeRows.map((r) => ({
    ...r,
    ...calculateRow(r, constants),
  }));
  const totals = calculateTotals(calculated);

  const totalItems = activeRows.reduce((s, r) => s + r.quantity, 0);
  const R = totals.finalPriceTotal; // revenue
  const C = totals.landedCostTotal; // landed cost
  const P = totals.profitTotal; // gross profit
  const T = totals.taxTotal; // tax
  const preTax = totals.preTaxPriceTotal;

  const marginPct = pct(P, R); // m = π / R
  const markup = pct(P, C); // π / C
  const effTax = pct(T, preTax); // T / preTax
  const costRatio = pct(C, R); // C / R
  const avgUnit = totalItems > 0 ? R / totalItems : 0;

  // ── Waterfall ──────────────────────────────────────────────────────────────
  const waterfallData = [
    { name: "JOD Base", base: 0, value: totals.jodPriceTotal, color: COLORS.jodPrice, milestone: false },
    { name: "+Shipping", base: totals.jodPriceTotal, value: totals.shippingTotal, color: COLORS.shipping, milestone: false },
    { name: "+Customs", base: totals.jodPriceTotal + totals.shippingTotal, value: totals.customsTotal, color: COLORS.customs, milestone: false },
    { name: "Landed C", base: 0, value: totals.landedCostTotal, color: COLORS.landedCost, milestone: true },
    { name: "+Profit π", base: totals.landedCostTotal, value: totals.profitTotal, color: COLORS.profit, milestone: false },
    { name: "+Tax T", base: totals.preTaxPriceTotal, value: totals.taxTotal, color: COLORS.tax, milestone: false },
    { name: "Revenue R", base: 0, value: totals.finalPriceTotal, color: COLORS.finalPrice, milestone: true },
  ];

  // ── Donut ──────────────────────────────────────────────────────────────────
  const donutData = [
    { name: "JOD Base", value: totals.jodPriceTotal, color: COLORS.jodPrice },
    { name: "Shipping", value: totals.shippingTotal, color: COLORS.shipping },
    { name: "Customs", value: totals.customsTotal, color: COLORS.customs },
    { name: "Profit", value: totals.profitTotal, color: COLORS.profit },
    { name: "Tax", value: totals.taxTotal, color: COLORS.tax },
  ];

  // ── Product contribution ──────────────────────────────────────────────────
  const contributionData = [...calculated]
    .sort((a, b) => b.finalPriceTotal - a.finalPriceTotal)
    .map((r) => ({
      name: r.itemModel.length > 20 ? r.itemModel.slice(0, 20) + "…" : r.itemModel,
      revenue: parseFloat(r.finalPriceTotal.toFixed(3)),
      landed: parseFloat(r.landedCostTotal.toFixed(3)),
      pct: parseFloat(((r.finalPriceTotal / totals.finalPriceTotal) * 100).toFixed(1)),
    }));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-gray-500">
          Quantitative Analysis
        </h3>
        <span className="font-mono text-[10px] text-gray-400">
          n = {activeRows.length} lines · {totalItems} units
        </span>
      </div>

      {/* ── KPI Cards (variables) ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Revenue"
          symbol="R"
          value={fmtJod(R)}
          formula="R = Σ (unit price × qty)"
          color={COLORS.finalPrice}
        />
        <KpiCard
          label="Landed Cost"
          symbol="C"
          value={fmtJod(C)}
          formula="C = base + shipping + customs"
          color={COLORS.landedCost}
        />
        <KpiCard
          label="Gross Profit"
          symbol="π"
          value={fmtJod(P)}
          formula="π = R − C − T"
          color={COLORS.profit}
        />
        <KpiCard
          label="Net Margin"
          symbol="m"
          value={`${marginPct.toFixed(2)} %`}
          formula="m = π ⁄ R"
          color="#8b5cf6"
        />
      </div>

      {/* ── Derived ratios strip ───────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-y-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <RatioStat expr="π ⁄ C" value={`${markup.toFixed(2)} %`} hint="markup on cost" />
        <RatioStat expr="C ⁄ R" value={`${costRatio.toFixed(2)} %`} hint="cost ratio" />
        <RatioStat expr="T ⁄ pretax" value={`${effTax.toFixed(2)} %`} hint="effective tax" />
        <RatioStat expr="R ⁄ n" value={fmtJod(avgUnit)} hint="avg unit revenue" />
        <RatioStat
          expr="FX"
          value={`${constants.currencyRate.toFixed(4)}`}
          hint="USD → JOD rate"
        />
      </div>

      {/* ── Waterfall + Donut ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Waterfall */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-2">
          <p className="font-mono text-xs font-semibold text-gray-700">
            Cost Buildup — Waterfall
          </p>
          <p className="mb-4 mt-0.5 font-mono text-[10px] text-gray-400">
            marginal Δ of each component, base → final revenue (JOD)
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={waterfallData}
              margin={{ top: 20, right: 12, left: 0, bottom: 4 }}
              barCategoryGap="28%"
            >
              <CartesianGrid strokeDasharray="2 4" stroke="#eef2f7" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "ui-monospace, monospace" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "ui-monospace, monospace" }}
                axisLine={false}
                tickLine={false}
                width={58}
                tickFormatter={fmtShort}
              />
              <Tooltip content={<WaterfallTooltip />} cursor={{ fill: "#f8fafc" }} />
              <ReferenceLine
                y={totals.finalPriceTotal}
                stroke={COLORS.finalPrice}
                strokeDasharray="4 3"
                strokeWidth={1.5}
                strokeOpacity={0.5}
              />
              <Bar dataKey="base" stackId="w" fill="transparent" legendType="none" />
              <Bar dataKey="value" stackId="w" radius={[3, 3, 0, 0]} maxBarSize={56}>
                {waterfallData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.color}
                    opacity={entry.milestone ? 1 : 0.82}
                    stroke={entry.milestone ? entry.color : "none"}
                    strokeWidth={entry.milestone ? 1.5 : 0}
                  />
                ))}
                <LabelList
                  dataKey="value"
                  position="top"
                  formatter={(v) => fmtShort(Number(v))}
                  style={{
                    fill: "#475569",
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: "ui-monospace, monospace",
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Donut */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="font-mono text-xs font-semibold text-gray-700">
            Revenue Composition
          </p>
          <p className="mb-2 mt-0.5 font-mono text-[10px] text-gray-400">
            share of each component in R
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={donutData}
                cx="50%"
                cy="44%"
                innerRadius={58}
                outerRadius={90}
                paddingAngle={2}
                dataKey="value"
                labelLine={false}
                label={renderDonutLabel}
              >
                {donutData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} stroke="transparent" />
                ))}
              </Pie>
              <Pie
                data={[{ value: 1 }]}
                cx="50%"
                cy="44%"
                innerRadius={0}
                outerRadius={0}
                dataKey="value"
                label={({ cx, cy }) => (
                  <DonutCenterLabel cx={cx} cy={cy} total={totals.finalPriceTotal} />
                )}
                labelLine={false}
                fill="transparent"
                stroke="none"
              />
              <Tooltip
                formatter={(v, name) => {
                  const num = Number(v);
                  return [
                    `${fmtJod(num)} (${((num / totals.finalPriceTotal) * 100).toFixed(2)}%)`,
                    String(name),
                  ];
                }}
                contentStyle={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  fontSize: 11,
                  fontFamily: "ui-monospace, monospace",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, color: "#64748b", paddingTop: 8 }}
                iconType="square"
                iconSize={8}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Numeric breakdown + Product contribution ───────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Exact ledger */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="font-mono text-xs font-semibold text-gray-700">
            Component Ledger
          </p>
          <p className="mb-3 mt-0.5 font-mono text-[10px] text-gray-400">
            exact JOD amounts · share of revenue
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-[10px] uppercase tracking-wider text-gray-400">
                <th className="py-1 text-left font-medium">Component</th>
                <th className="py-1 text-right font-medium">JOD</th>
                <th className="py-1 pl-2 text-right font-medium">% R</th>
              </tr>
            </thead>
            <tbody>
              <BreakdownRow label="JOD Base" color={COLORS.jodPrice} amount={totals.jodPriceTotal} share={pct(totals.jodPriceTotal, R)} />
              <BreakdownRow label="Shipping" color={COLORS.shipping} amount={totals.shippingTotal} share={pct(totals.shippingTotal, R)} />
              <BreakdownRow label="Customs" color={COLORS.customs} amount={totals.customsTotal} share={pct(totals.customsTotal, R)} />
              <BreakdownRow label="Profit π" color={COLORS.profit} amount={P} share={pct(P, R)} />
              <BreakdownRow label="Tax T" color={COLORS.tax} amount={T} share={pct(T, R)} />
              <BreakdownRow label="Revenue R" color={COLORS.finalPrice} amount={R} share={100} strong />
            </tbody>
          </table>
        </div>

        {/* Product contribution */}
        {contributionData.length >= 1 && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-2">
            <p className="font-mono text-xs font-semibold text-gray-700">
              Revenue by Product
            </p>
            <p className="mb-4 mt-0.5 font-mono text-[10px] text-gray-400">
              final price × qty · landed cost underlaid · % of R at right
            </p>
            <ResponsiveContainer
              width="100%"
              height={Math.max(180, contributionData.length * 44)}
            >
              <BarChart
                data={contributionData}
                layout="vertical"
                margin={{ top: 4, right: 64, left: 8, bottom: 4 }}
                barCategoryGap="24%"
              >
                <CartesianGrid strokeDasharray="2 4" stroke="#eef2f7" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "ui-monospace, monospace" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={fmtShort}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: "#475569", fontSize: 11, fontFamily: "ui-monospace, monospace" }}
                  axisLine={false}
                  tickLine={false}
                  width={120}
                />
                <Tooltip
                  formatter={(v, key) => [
                    `${fmtJod(Number(v))} JOD`,
                    String(key) === "revenue" ? "Final Revenue" : "Landed Cost",
                  ]}
                  contentStyle={{
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    fontSize: 11,
                    fontFamily: "ui-monospace, monospace",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 10, color: "#64748b" }}
                  iconType="square"
                  iconSize={8}
                />
                <Bar dataKey="landed" name="Landed Cost" fill={COLORS.landedCost} radius={[0, 3, 3, 0]} opacity={0.35} />
                <Bar dataKey="revenue" name="Final Revenue" fill={COLORS.finalPrice} radius={[0, 3, 3, 0]}>
                  <LabelList
                    dataKey="pct"
                    position="right"
                    formatter={(v) => `${Number(v)}%`}
                    style={{
                      fill: "#64748b",
                      fontSize: 10,
                      fontWeight: 600,
                      fontFamily: "ui-monospace, monospace",
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
