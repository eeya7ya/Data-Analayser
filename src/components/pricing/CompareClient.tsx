"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  calculateRow,
  calculateTotals,
  type Constants,
} from "@/lib/pricing/calculations";
import { cn } from "@/lib/pricing/utils";
import PageLoader from "@/components/PageLoader";
import { GitCompare, Factory, ArrowRight } from "@/lib/icons";

interface ProductLine {
  id: number;
  position: number;
  itemModel: string;
  priceUsd: string;
  quantity: number;
}

interface RawConstants {
  currencyRate: string;
  shippingRate: string;
  customsRate: string;
  profitMargin: string;
  taxRate: string;
}

interface ProjectData {
  project: { id: number; name: string };
  constants: RawConstants | null;
  productLines: ProductLine[];
}

interface ManufacturerData {
  manufacturer: { id: number; name: string };
  projects: ProjectData[];
}

const MANUFACTURER_COLORS = [
  "#0891b2",
  "#7c3aed",
  "#16a34a",
  "#d97706",
  "#e11d48",
  "#2563eb",
];

function N(v: number) {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function computeSummary(data: ManufacturerData) {
  let grandFinalTotal = 0;
  let grandLandedTotal = 0;
  let totalProducts = 0;

  for (const { constants: c, productLines } of data.projects) {
    if (!c) continue;
    const constants: Constants = {
      currencyRate: parseFloat(c.currencyRate),
      shippingRate: parseFloat(c.shippingRate),
      customsRate: parseFloat(c.customsRate),
      profitMargin: parseFloat(c.profitMargin),
      taxRate: parseFloat(c.taxRate),
    };
    const active = productLines.filter((l) => parseFloat(l.priceUsd) > 0);
    totalProducts += active.length;
    const calcs = active.map((l) =>
      calculateRow(
        {
          itemModel: l.itemModel,
          priceUsd: parseFloat(l.priceUsd),
          quantity: l.quantity,
        },
        constants
      )
    );
    const totals = calculateTotals(calcs);
    grandFinalTotal += totals.finalPriceTotal;
    grandLandedTotal += totals.landedCostTotal;
  }

  return { grandFinalTotal, grandLandedTotal, totalProducts };
}

export default function ComparePage() {
  const [data, setData] = useState<ManufacturerData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/pricing/compare");
        if (res.ok) {
          const d: ManufacturerData[] = await res.json();
          setData(d);
          setSelected(new Set(d.map((m) => m.manufacturer.id)));
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = data.filter((d) => selected.has(d.manufacturer.id));

  const summaries = filtered.map((d, i) => {
    const { grandFinalTotal, grandLandedTotal } = computeSummary(d);
    return {
      name: d.manufacturer.name.length > 12
        ? d.manufacturer.name.slice(0, 12) + "…"
        : d.manufacturer.name,
      "Total Revenue (JOD)": parseFloat(grandFinalTotal.toFixed(2)),
      "Total Landed Cost (JOD)": parseFloat(grandLandedTotal.toFixed(2)),
      color: MANUFACTURER_COLORS[i % MANUFACTURER_COLORS.length],
    };
  });

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-3 text-xs shadow-lg">
        <p className="mb-2 font-semibold text-gray-800">{label}</p>
        {payload.map((entry: any) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: entry.color }}
              />
              <span className="text-gray-500">{entry.name}</span>
            </span>
            <span className="font-mono font-medium text-gray-800">
              {entry.value.toLocaleString()} JOD
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-10 sm:px-6">
      {/* Header */}
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-cyan-600">
          <GitCompare className="h-3.5 w-3.5" />
          All Manufacturers
        </div>
        <h1 className="text-3xl font-bold text-gray-900">Comparison View</h1>
        <p className="mt-1.5 text-sm text-gray-500">
          Compare revenue and cost totals across all manufacturers
        </p>
      </div>

      {loading ? (
        <PageLoader label="Loading comparison…" />
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-20 text-center">
          <Factory className="mb-4 h-10 w-10 text-gray-300" />
          <p className="text-gray-500">No manufacturers yet</p>
          <Link
            href="/pricing"
            className="mt-4 text-sm text-cyan-600 hover:text-cyan-500"
          >
            Go to Dashboard →
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Filter toggles */}
          <div className="flex flex-wrap gap-2">
            {data.map((d, i) => (
              <button
                key={d.manufacturer.id}
                onClick={() => {
                  const next = new Set(selected);
                  if (next.has(d.manufacturer.id)) {
                    next.delete(d.manufacturer.id);
                  } else {
                    next.add(d.manufacturer.id);
                  }
                  setSelected(next);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all",
                  selected.has(d.manufacturer.id)
                    ? "ring-1 text-gray-800"
                    : "bg-gray-100 text-gray-400"
                )}
                style={
                  selected.has(d.manufacturer.id)
                    ? {
                        background: `${MANUFACTURER_COLORS[i % MANUFACTURER_COLORS.length]}15`,
                        border: `1px solid ${MANUFACTURER_COLORS[i % MANUFACTURER_COLORS.length]}40`,
                      }
                    : {}
                }
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    background: selected.has(d.manufacturer.id)
                      ? MANUFACTURER_COLORS[i % MANUFACTURER_COLORS.length]
                      : "#94a3b8",
                  }}
                />
                {d.manufacturer.name}
              </button>
            ))}
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((d, i) => {
              const { grandFinalTotal, grandLandedTotal, totalProducts } =
                computeSummary(d);
              const color = MANUFACTURER_COLORS[
                data.findIndex((x) => x.manufacturer.id === d.manufacturer.id) %
                  MANUFACTURER_COLORS.length
              ];
              return (
                <Link
                  key={d.manufacturer.id}
                  href={`/pricing/manufacturer/${d.manufacturer.id}`}
                  className={cn(
                    "group rounded-xl border border-gray-200 bg-white p-4 transition-all",
                    "hover:border-gray-300 hover:shadow-md hover:shadow-gray-100"
                  )}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-lg"
                      style={{ background: `${color}15`, border: `1px solid ${color}30` }}
                    >
                      <Factory className="h-4 w-4" style={{ color }} />
                    </div>
                    <ArrowRight
                      className="h-3.5 w-3.5 text-gray-300 transition-colors group-hover:text-gray-500"
                    />
                  </div>
                  <h3 className="mb-1 font-semibold text-gray-900">
                    {d.manufacturer.name}
                  </h3>
                  <div className="mb-3 text-xs text-gray-500">
                    {d.projects.length} projects · {totalProducts} products
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">Landed Cost</span>
                      <span className="font-mono font-medium text-gray-700">
                        {N(grandLandedTotal)} JOD
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">Total Revenue</span>
                      <span className="font-mono font-semibold" style={{ color }}>
                        {N(grandFinalTotal)} JOD
                      </span>
                    </div>
                    {grandLandedTotal > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">Margin</span>
                        <span className="font-mono font-medium text-emerald-600">
                          {N(((grandFinalTotal - grandLandedTotal) / grandLandedTotal) * 100)}%
                        </span>
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Revenue comparison chart */}
          {summaries.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h3 className="mb-4 text-sm font-semibold text-gray-700">
                Revenue vs Landed Cost (JOD)
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={summaries}
                  margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "#64748b", fontSize: 12 }}
                    axisLine={{ stroke: "#e2e8f0" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    axisLine={{ stroke: "#e2e8f0" }}
                    tickLine={false}
                    width={70}
                    tickFormatter={(v) => v.toLocaleString()}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#64748b" }} />
                  <Bar
                    dataKey="Total Revenue (JOD)"
                    fill="#0891b2"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="Total Landed Cost (JOD)"
                    fill="#94a3b8"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Per-manufacturer detailed breakdown */}
          <div className="space-y-6">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-500">
              Detailed Breakdown
            </h2>
            {filtered.map((d) => {
              const color =
                MANUFACTURER_COLORS[
                  data.findIndex((x) => x.manufacturer.id === d.manufacturer.id) %
                    MANUFACTURER_COLORS.length
                ];

              return (
                <div
                  key={d.manufacturer.id}
                  className="rounded-xl border border-gray-200 bg-white overflow-hidden"
                >
                  {/* Manufacturer header */}
                  <div
                    className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50"
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <div className="flex items-center gap-2">
                      <Factory className="h-4 w-4" style={{ color }} />
                      <span className="font-semibold text-gray-800">
                        {d.manufacturer.name}
                      </span>
                    </div>
                    <Link
                      href={`/pricing/manufacturer/${d.manufacturer.id}`}
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors"
                    >
                      Open Sheet
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>

                  {/* Projects table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Project</th>
                          <th className="px-4 py-2.5 text-right text-gray-500 font-medium">Products</th>
                          <th className="px-4 py-2.5 text-right text-gray-500 font-medium">Landed Cost</th>
                          <th className="px-4 py-2.5 text-right text-gray-500 font-medium">Revenue</th>
                          <th className="px-4 py-2.5 text-right text-gray-500 font-medium">Gross Margin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.projects.map(({ project, constants: c, productLines }) => {
                          if (!c) return null;
                          const constants: Constants = {
                            currencyRate: parseFloat(c.currencyRate),
                            shippingRate: parseFloat(c.shippingRate),
                            customsRate: parseFloat(c.customsRate),
                            profitMargin: parseFloat(c.profitMargin),
                            taxRate: parseFloat(c.taxRate),
                          };
                          const active = productLines.filter(
                            (l) => parseFloat(l.priceUsd) > 0
                          );
                          const calcs = active.map((l) =>
                            calculateRow(
                              {
                                itemModel: l.itemModel,
                                priceUsd: parseFloat(l.priceUsd),
                                quantity: l.quantity,
                              },
                              constants
                            )
                          );
                          const totals = calculateTotals(calcs);
                          const margin =
                            totals.landedCostTotal > 0
                              ? ((totals.finalPriceTotal - totals.landedCostTotal) /
                                  totals.landedCostTotal) *
                                100
                              : 0;

                          return (
                            <tr
                              key={project.id}
                              className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                            >
                              <td className="px-4 py-2.5 text-gray-700">{project.name}</td>
                              <td className="px-4 py-2.5 text-right text-gray-500">{active.length}</td>
                              <td className="px-4 py-2.5 text-right font-mono text-gray-700">
                                {N(totals.landedCostTotal)}
                              </td>
                              <td
                                className="px-4 py-2.5 text-right font-mono font-semibold"
                                style={{ color }}
                              >
                                {N(totals.finalPriceTotal)}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-emerald-600">
                                {N(margin)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
