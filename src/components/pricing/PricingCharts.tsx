"use client";

import {
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LabelList,
  ReferenceLine,
} from "recharts";
import { type Constants, type ProductInput } from "@/lib/pricing/calculations";
import { analyzePricing } from "@/lib/pricing/analysis";

interface Row extends ProductInput {
  position: number;
}

interface Props {
  rows: Row[];
  constants: Constants;
}

// ── Restrained palette ────────────────────────────────────────────────────────
// Costs are a graduated cool-grey ramp; profit is the single teal accent; tax is
// one muted ochre; revenue is ink. Three colours + greyscale — no rainbow.
const INK = "#0f172a";
const ACCENT = "#0d9488"; // teal — profit
const TAX = "#b45309"; // muted ochre — tax (a pass-through, not margin)
const C = {
  base: "#475569",
  shipping: "#7c8ba1",
  customs: "#b0bccd",
  landed: "#1e293b",
};

function fmtJod(v: number) {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}
function fmtShort(v: number) {
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + "k";
  return v.toFixed(0);
}

// ── KPI card ─────────────────────────────────────────────────────────────────
function Kpi({
  label,
  symbol,
  value,
  formula,
  accent,
}: {
  label: string;
  symbol: string;
  value: string;
  formula: string;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-lg border border-slate-200 bg-white p-4"
      style={{ borderLeft: `3px solid ${accent ? ACCENT : "#cbd5e1"}` }}
    >
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          {label}
        </p>
        <span
          className="font-mono text-sm italic font-semibold"
          style={{ color: accent ? ACCENT : "#94a3b8" }}
        >
          {symbol}
        </span>
      </div>
      <p
        className="mt-2 font-mono text-2xl font-bold leading-none tracking-tight tabular-nums"
        style={{ color: accent ? ACCENT : INK }}
      >
        {value}
      </p>
      <p className="mt-2 font-mono text-[10.5px] leading-tight text-slate-400">
        {formula}
      </p>
    </div>
  );
}

function Ratio({
  label,
  expr,
  value,
  bar,
  tone = "slate",
}: {
  label: string;
  expr: string;
  value: string;
  /** 0–1 fill for the meter; omit for non-percentage values. */
  bar?: number | null;
  tone?: "accent" | "slate" | "tax";
}) {
  const color = tone === "tax" ? TAX : tone === "accent" ? ACCENT : "#94a3b8";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase leading-tight tracking-wide text-slate-500">
          {label}
        </span>
        <span className="flex-shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
          {expr}
        </span>
      </div>
      <p
        className="mt-2 font-mono text-xl font-bold leading-none tabular-nums"
        style={{ color: tone === "slate" ? INK : color }}
      >
        {value}
      </p>
      {bar != null && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(2, Math.min(100, bar * 100))}%`,
              background: color,
            }}
          />
        </div>
      )}
    </div>
  );
}

function Panel({
  title,
  note,
  children,
  className = "",
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-4 ${className}`}>
      <p className="font-mono text-xs font-semibold text-slate-700">{title}</p>
      {note && <p className="mt-0.5 mb-3 font-mono text-[10px] text-slate-400">{note}</p>}
      {children}
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
    <div className="rounded-md border border-slate-200 bg-white p-3 text-xs shadow-lg">
      <p className="mb-2 border-b border-slate-100 pb-1 font-mono font-semibold text-slate-800">
        {label}
      </p>
      <div className="flex items-center justify-between gap-6 py-0.5">
        <span className="text-slate-500">Δ this step</span>
        <span className="font-mono font-semibold text-slate-800">{fmtJod(entry.value)}</span>
      </div>
      {(base?.value ?? 0) > 0 && (
        <div className="mt-0.5 flex items-center justify-between gap-6 border-t border-slate-100 py-0.5 pt-1">
          <span className="text-slate-400">Σ cumulative</span>
          <span className="font-mono text-slate-600">{fmtJod(cumulative)}</span>
        </div>
      )}
    </div>
  );
};

const DonutCenter = ({ cx, cy, total }: { cx: number; cy: number; total: number }) => (
  <g>
    <text x={cx} y={cy - 8} textAnchor="middle" fill="#94a3b8" fontSize={10}>
      Σ Revenue
    </text>
    <text
      x={cx}
      y={cy + 11}
      textAnchor="middle"
      fill={INK}
      fontSize={15}
      fontWeight={700}
      style={{ fontFamily: "ui-monospace, monospace" }}
    >
      {fmtShort(total)}
    </text>
    <text x={cx} y={cy + 25} textAnchor="middle" fill="#94a3b8" fontSize={9}>
      JOD
    </text>
  </g>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const donutLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.08) return null;
  const RAD = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + r * Math.cos(-midAngle * RAD);
  const y = cy + r * Math.sin(-midAngle * RAD);
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
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

function LedgerRow({
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
    <tr className={strong ? "border-t border-slate-200 font-semibold" : ""}>
      <td className="py-1.5 pr-2">
        <span className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
          <span className="text-slate-700">{label}</span>
        </span>
      </td>
      <td className="py-1.5 text-right font-mono tabular-nums text-slate-800">{fmtJod(amount)}</td>
      <td className="py-1.5 pl-2 text-right font-mono tabular-nums text-slate-500">
        {share.toFixed(1)}%
      </td>
    </tr>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function PricingCharts({ rows, constants }: Props) {
  const a = analyzePricing(rows, constants);

  if (!a) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-400">
        Enter product data above to see the quantitative analysis
      </div>
    );
  }

  const waterfall = [
    { name: "JOD Base", base: 0, value: a.jodBase, color: C.base, milestone: false },
    { name: "+Shipping", base: a.jodBase, value: a.shipping, color: C.shipping, milestone: false },
    { name: "+Customs", base: a.jodBase + a.shipping, value: a.customs, color: C.customs, milestone: false },
    { name: "Landed C", base: 0, value: a.landedCost, color: C.landed, milestone: true },
    { name: "+Profit π", base: a.landedCost, value: a.profit, color: ACCENT, milestone: false },
    { name: "+Tax T", base: a.preTax, value: a.tax, color: TAX, milestone: false },
    { name: "Revenue R", base: 0, value: a.revenue, color: INK, milestone: true },
  ];

  const donut = [
    { name: "JOD Base", value: a.jodBase, color: C.base },
    { name: "Shipping", value: a.shipping, color: C.shipping },
    { name: "Customs", value: a.customs, color: C.customs },
    { name: "Profit", value: a.profit, color: ACCENT },
    { name: "Tax", value: a.tax, color: TAX },
  ];

  // Pareto: revenue bars (desc) + cumulative % line.
  const pareto = a.contributions.map((c) => ({
    name: c.name.length > 14 ? c.name.slice(0, 14) + "…" : c.name,
    revenue: parseFloat(c.revenue.toFixed(3)),
    cumulative: parseFloat(c.cumulativePct.toFixed(1)),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Quantitative Analysis
        </h3>
        <span className="font-mono text-[10px] text-slate-400">
          n = {a.lines} lines · {a.units} units · FX {a.fx.toFixed(4)}
        </span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Revenue" symbol="R" value={fmtJod(a.revenue)} formula="R = Σ price × qty" />
        <Kpi label="Landed Cost" symbol="C" value={fmtJod(a.landedCost)} formula="C = base + ship + customs" />
        <Kpi label="Gross Profit" symbol="π" value={fmtJod(a.profit)} formula="π = R − C − T" accent />
        <Kpi label="Net Margin" symbol="m" value={`${a.marginPct.toFixed(2)} %`} formula="m = π ⁄ R" accent />
      </div>

      {/* Insights — the written analysis */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
        <p className="mb-3 font-mono text-xs font-semibold text-slate-700">Analysis &amp; Commentary</p>
        <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {a.insights.map((text, i) => (
            <li key={i} className="flex gap-2.5 text-[12px] leading-relaxed text-slate-600">
              <span
                className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ background: ACCENT }}
              />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Derived ratios — each a clear stat with a meter */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Ratio
          label="Markup on cost"
          expr="π⁄C"
          value={`${a.markupPct.toFixed(1)}%`}
          bar={a.markupPct / 100}
          tone="accent"
        />
        <Ratio
          label="Cost ratio"
          expr="C⁄R"
          value={`${a.costRatioPct.toFixed(1)}%`}
          bar={a.costRatioPct / 100}
          tone="slate"
        />
        <Ratio
          label="Effective tax"
          expr="T⁄pretax"
          value={`${a.effTaxPct.toFixed(1)}%`}
          bar={a.effTaxPct / 100}
          tone="tax"
        />
        <Ratio
          label="Avg unit revenue"
          expr="R⁄n"
          value={`${fmtJod(a.avgUnitRevenue)} JOD`}
          tone="slate"
        />
        <Ratio
          label="Revenue in top 2"
          expr="top₂"
          value={`${a.top2Pct.toFixed(1)}%`}
          bar={a.top2Pct / 100}
          tone="accent"
        />
      </div>

      {/* Waterfall + Donut */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel
          title="Cost Buildup — Waterfall"
          note="marginal Δ of each component, base → final revenue (JOD)"
          className="lg:col-span-2"
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={waterfall} margin={{ top: 20, right: 12, left: 0, bottom: 4 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="2 5" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "ui-monospace, monospace" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "ui-monospace, monospace" }} axisLine={false} tickLine={false} width={58} tickFormatter={fmtShort} />
              <Tooltip content={<WaterfallTooltip />} cursor={{ fill: "#f8fafc" }} />
              <ReferenceLine y={a.revenue} stroke={INK} strokeDasharray="4 4" strokeWidth={1} strokeOpacity={0.35} />
              <Bar dataKey="base" stackId="w" fill="transparent" />
              <Bar dataKey="value" stackId="w" radius={[3, 3, 0, 0]} maxBarSize={54}>
                {waterfall.map((e, i) => (
                  <Cell key={i} fill={e.color} opacity={e.milestone ? 1 : 0.9} />
                ))}
                <LabelList
                  dataKey="value"
                  position="top"
                  formatter={(v) => fmtShort(Number(v))}
                  style={{ fill: "#475569", fontSize: 10, fontWeight: 600, fontFamily: "ui-monospace, monospace" }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Revenue Composition" note="share of each component in R">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={donut}
                cx="50%"
                cy="44%"
                innerRadius={58}
                outerRadius={90}
                paddingAngle={1.5}
                dataKey="value"
                labelLine={false}
                label={donutLabel}
                stroke="#fff"
                strokeWidth={1.5}
              >
                {donut.map((e, i) => (
                  <Cell key={i} fill={e.color} />
                ))}
              </Pie>
              <Pie
                data={[{ value: 1 }]}
                cx="50%"
                cy="44%"
                innerRadius={0}
                outerRadius={0}
                dataKey="value"
                labelLine={false}
                fill="transparent"
                stroke="none"
                label={({ cx, cy }) => <DonutCenter cx={cx} cy={cy} total={a.revenue} />}
              />
              <Tooltip
                formatter={(v, name) => [
                  `${fmtJod(Number(v))} (${((Number(v) / a.revenue) * 100).toFixed(1)}%)`,
                  String(name),
                ]}
                contentStyle={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: "ui-monospace, monospace",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Compact legend */}
          <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1">
            {donut.map((e) => (
              <span key={e.name} className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: e.color }} />
                {e.name}
              </span>
            ))}
          </div>
        </Panel>
      </div>

      {/* Ledger + Pareto */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Component Ledger" note="exact JOD amounts · share of revenue">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400">
                <th className="py-1 text-left font-medium">Component</th>
                <th className="py-1 text-right font-medium">JOD</th>
                <th className="py-1 pl-2 text-right font-medium">% R</th>
              </tr>
            </thead>
            <tbody>
              <LedgerRow label="JOD Base" color={C.base} amount={a.jodBase} share={a.comp.base} />
              <LedgerRow label="Shipping" color={C.shipping} amount={a.shipping} share={a.comp.shipping} />
              <LedgerRow label="Customs" color={C.customs} amount={a.customs} share={a.comp.customs} />
              <LedgerRow label="Profit π" color={ACCENT} amount={a.profit} share={a.comp.profit} />
              <LedgerRow label="Tax T" color={TAX} amount={a.tax} share={a.comp.tax} />
              <LedgerRow label="Revenue R" color={INK} amount={a.revenue} share={100} strong />
            </tbody>
          </table>
        </Panel>

        {pareto.length >= 1 && (
          <Panel
            title="Revenue by Product — Pareto"
            note="bars = revenue (desc) · line = cumulative % of total"
            className="lg:col-span-2"
          >
            <ResponsiveContainer width="100%" height={Math.max(240, 240)}>
              <ComposedChart data={pareto} margin={{ top: 16, right: 46, left: 0, bottom: 4 }} barCategoryGap="26%">
                <CartesianGrid strokeDasharray="2 5" stroke="#eef2f7" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#64748b", fontSize: 10, fontFamily: "ui-monospace, monospace" }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                  angle={pareto.length > 6 ? -25 : 0}
                  textAnchor={pareto.length > 6 ? "end" : "middle"}
                  height={pareto.length > 6 ? 44 : 20}
                />
                <YAxis
                  yAxisId="rev"
                  tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "ui-monospace, monospace" }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                  tickFormatter={fmtShort}
                />
                <YAxis
                  yAxisId="cum"
                  orientation="right"
                  domain={[0, 100]}
                  tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "ui-monospace, monospace" }}
                  axisLine={false}
                  tickLine={false}
                  width={34}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  formatter={(v, key) => [
                    key === "cumulative" ? `${Number(v).toFixed(1)}%` : `${fmtJod(Number(v))} JOD`,
                    key === "cumulative" ? "Cumulative" : "Revenue",
                  ]}
                  contentStyle={{
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    fontSize: 11,
                    fontFamily: "ui-monospace, monospace",
                  }}
                />
                <ReferenceLine yAxisId="cum" y={80} stroke="#cbd5e1" strokeDasharray="3 3" />
                <Bar yAxisId="rev" dataKey="revenue" fill={ACCENT} radius={[3, 3, 0, 0]} maxBarSize={48} />
                <Line
                  yAxisId="cum"
                  type="monotone"
                  dataKey="cumulative"
                  stroke={INK}
                  strokeWidth={1.75}
                  dot={{ r: 2.5, fill: INK }}
                  activeDot={{ r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>
        )}
      </div>
    </div>
  );
}
