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
  jodPrice:   "#f59e0b",
  shipping:   "#3b82f6",
  customs:    "#8b5cf6",
  landedCost: "#f97316",
  profit:     "#22c55e",
  tax:        "#ef4444",
  finalPrice: "#06b6d4",
};

function fmtJod(v: number) {
  return v.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function fmtShort(v: number) {
  if (v >= 1000) return (v / 1000).toFixed(1) + "k";
  return v.toFixed(0);
}

// ── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  sub,
  color,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  icon: string;
}) {
  return (
    <div
      className="rounded-xl border border-gray-200 bg-white p-4 flex flex-col gap-2"
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <span className="text-base" aria-hidden>{icon}</span>
      </div>
      <p className="text-xl font-bold leading-tight" style={{ color }}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
    </div>
  );
}

// ── Waterfall tooltip ─────────────────────────────────────────────────────────
const WaterfallTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const entry = payload.find((e: any) => e.dataKey === "value");
  const base = payload.find((e: any) => e.dataKey === "base");
  if (!entry) return null;
  const cumulative = (base?.value ?? 0) + entry.value;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 text-xs shadow-xl">
      <p className="mb-2 font-semibold text-gray-800 border-b border-gray-100 pb-1">{label}</p>
      <div className="flex items-center justify-between gap-6 py-0.5">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-gray-500">This step</span>
        </span>
        <span className="font-mono font-semibold text-gray-800">{fmtJod(entry.value)} JOD</span>
      </div>
      {(base?.value ?? 0) > 0 && (
        <div className="flex items-center justify-between gap-6 py-0.5 mt-0.5 pt-1 border-t border-gray-100">
          <span className="text-gray-400">Cumulative</span>
          <span className="font-mono text-gray-600">{fmtJod(cumulative)} JOD</span>
        </div>
      )}
    </div>
  );
};

// ── Donut center label ────────────────────────────────────────────────────────
const DonutCenterLabel = ({ cx, cy, total }: { cx: number; cy: number; total: number }) => (
  <g>
    <text x={cx} y={cy - 8} textAnchor="middle" fill="#94a3b8" fontSize={10}>
      Total
    </text>
    <text x={cx} y={cy + 10} textAnchor="middle" fill="#1e293b" fontSize={13} fontWeight={700}>
      {fmtShort(total)}
    </text>
    <text x={cx} y={cy + 23} textAnchor="middle" fill="#94a3b8" fontSize={9}>
      JOD
    </text>
  </g>
);

// ── Donut percent label ───────────────────────────────────────────────────────
const renderDonutLabel = ({
  cx, cy, midAngle, innerRadius, outerRadius, percent,
}: any) => {
  if (percent < 0.06) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={10} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
export function PricingCharts({ rows, constants }: Props) {
  const activeRows = rows.filter((r) => r.priceUsd > 0 && r.itemModel);

  if (activeRows.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-gray-200 text-sm text-gray-400">
        Enter product data above to see visualizations
      </div>
    );
  }

  const calculated = activeRows.map((r) => ({ ...r, ...calculateRow(r, constants) }));
  const totals = calculateTotals(calculated);

  const totalItems = activeRows.reduce((s, r) => s + r.quantity, 0);
  const marginPct =
    totals.finalPriceTotal > 0
      ? (totals.profitTotal / totals.finalPriceTotal) * 100
      : 0;
  const markup =
    totals.landedCostTotal > 0
      ? (totals.profitTotal / totals.landedCostTotal) * 100
      : 0;

  // ── Waterfall ──────────────────────────────────────────────────────────────
  const waterfallData = [
    { name: "JOD Base",     base: 0,                                                value: totals.jodPriceTotal,   color: COLORS.jodPrice,   milestone: false },
    { name: "+Shipping",    base: totals.jodPriceTotal,                             value: totals.shippingTotal,   color: COLORS.shipping,   milestone: false },
    { name: "+Customs",     base: totals.jodPriceTotal + totals.shippingTotal,      value: totals.customsTotal,    color: COLORS.customs,    milestone: false },
    { name: "Landed Cost",  base: 0,                                                value: totals.landedCostTotal, color: COLORS.landedCost, milestone: true  },
    { name: "+Profit",      base: totals.landedCostTotal,                           value: totals.profitTotal,     color: COLORS.profit,     milestone: false },
    { name: "+Tax",         base: totals.preTaxPriceTotal,                          value: totals.taxTotal,        color: COLORS.tax,        milestone: false },
    { name: "Final Rev.",   base: 0,                                                value: totals.finalPriceTotal, color: COLORS.finalPrice, milestone: true  },
  ];

  // ── Donut ──────────────────────────────────────────────────────────────────
  const donutData = [
    { name: "JOD Base", value: totals.jodPriceTotal,  color: COLORS.jodPrice  },
    { name: "Shipping",  value: totals.shippingTotal,  color: COLORS.shipping  },
    { name: "Customs",   value: totals.customsTotal,   color: COLORS.customs   },
    { name: "Profit",    value: totals.profitTotal,    color: COLORS.profit    },
    { name: "Tax",       value: totals.taxTotal,       color: COLORS.tax       },
  ];

  // ── Product contribution ──────────────────────────────────────────────────
  const contributionData = [...calculated]
    .sort((a, b) => b.finalPriceTotal - a.finalPriceTotal)
    .map((r) => ({
      name:    r.itemModel.length > 20 ? r.itemModel.slice(0, 20) + "…" : r.itemModel,
      revenue: parseFloat(r.finalPriceTotal.toFixed(3)),
      landed:  parseFloat(r.landedCostTotal.toFixed(3)),
      pct:     parseFloat(((r.finalPriceTotal / totals.finalPriceTotal) * 100).toFixed(1)),
    }));

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
        Analysis
      </h3>

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Total Revenue"
          value={`${fmtJod(totals.finalPriceTotal)} JOD`}
          sub={`${totalItems} unit${totalItems !== 1 ? "s" : ""} · all products`}
          color={COLORS.finalPrice}
          icon="💰"
        />
        <KpiCard
          label="Landed Cost"
          value={`${fmtJod(totals.landedCostTotal)} JOD`}
          sub="base + shipping + customs"
          color={COLORS.landedCost}
          icon="📦"
        />
        <KpiCard
          label="Gross Profit"
          value={`${fmtJod(totals.profitTotal)} JOD`}
          sub={`${markup.toFixed(1)}% markup on cost`}
          color={COLORS.profit}
          icon="📈"
        />
        <KpiCard
          label="Net Margin"
          value={`${marginPct.toFixed(1)}%`}
          sub="profit ÷ revenue"
          color="#8b5cf6"
          icon="🎯"
        />
      </div>

      {/* ── Waterfall + Donut ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Waterfall */}
        <div className="lg:col-span-2 rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-gray-700">Cost Buildup — Waterfall</p>
          <p className="mt-0.5 mb-4 text-[10px] text-gray-400">
            Step-by-step accumulation from base price to final revenue (JOD)
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={waterfallData} margin={{ top: 20, right: 12, left: 0, bottom: 4 }} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 10 }}
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
              {/* Invisible offset bar creates the floating effect */}
              <Bar dataKey="base" stackId="w" fill="transparent" legendType="none" />
              <Bar dataKey="value" stackId="w" radius={[5, 5, 0, 0]} maxBarSize={56}>
                {waterfallData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.color}
                    opacity={entry.milestone ? 1 : 0.85}
                    stroke={entry.milestone ? entry.color : "none"}
                    strokeWidth={entry.milestone ? 1.5 : 0}
                  />
                ))}
                <LabelList
                  dataKey="value"
                  position="top"
                  formatter={(v) => fmtShort(Number(v))}
                  style={{ fill: "#475569", fontSize: 10, fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Donut */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-gray-700">Revenue Composition</p>
          <p className="mt-0.5 mb-2 text-[10px] text-gray-400">Share of each cost component</p>
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
              {/* SVG center label via customized label prop on a zero-radius Pie */}
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
                    `${fmtJod(num)} JOD (${((num / totals.finalPriceTotal) * 100).toFixed(1)}%)`,
                    String(name),
                  ];
                }}
                contentStyle={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  fontSize: 11,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, color: "#64748b", paddingTop: 8 }}
                iconType="circle"
                iconSize={7}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Product Revenue Contribution ──────────────────────────────────── */}
      {contributionData.length > 1 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-gray-700">Revenue by Product</p>
          <p className="mt-0.5 mb-4 text-[10px] text-gray-400">
            Final selling price × quantity — percentage of total revenue shown at right
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
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={fmtShort}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fill: "#475569", fontSize: 11 }}
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
                  borderRadius: 10,
                  fontSize: 11,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, color: "#64748b" }}
                iconType="circle"
                iconSize={7}
              />
              {/* Landed cost behind revenue */}
              <Bar dataKey="landed" name="Landed Cost" fill={COLORS.landedCost} radius={[0, 4, 4, 0]} opacity={0.35} />
              <Bar dataKey="revenue" name="Final Revenue" fill={COLORS.finalPrice} radius={[0, 4, 4, 0]}>
                <LabelList
                  dataKey="pct"
                  position="right"
                  formatter={(v) => `${Number(v)}%`}
                  style={{ fill: "#64748b", fontSize: 10, fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
