"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Search,
  ScanSearch,
  ArrowUpDown,
  Factory,
  Package,
  X,
} from "lucide-react";
import Spinner from "@/components/Spinner";
import { cn } from "@/lib/pricing/utils";

interface ItemHit {
  lineId: number;
  itemModel: string;
  priceUsd: number;
  quantity: number;
  projectId: number;
  projectName: string;
  date: string | null;
  responsiblePerson: string | null;
  revisionNumber: number;
  parentProjectId: number | null;
  createdAt: string | null;
  ownerUserId: number | null;
  manufacturerId: number;
  manufacturerName: string;
  manufacturerColor: string | null;
  manufacturerTag: string | null;
  currencyRate: number;
  unitLandedCost: number;
  unitFinalPrice: number;
  landedCostTotal: number;
  finalPriceTotal: number;
}

type SortKey = "date_desc" | "date_asc" | "cost_desc" | "cost_asc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "date_desc", label: "Newest first" },
  { value: "date_asc", label: "Oldest first" },
  { value: "cost_desc", label: "Highest cost" },
  { value: "cost_asc", label: "Lowest cost" },
];

const N = (v: number): string =>
  v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * Deep item search workspace. The user types an item, and every line
 * across every project they can see is listed with its landed cost,
 * sell price and the project it lived in — sortable by date or cost.
 *
 * The actual matching, cost computation and ordering all happen in
 * /api/pricing/items/search; this component is the debounced input plus
 * the result table.
 */
export default function DeepSearchClient() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("date_desc");
  const [results, setResults] = useState<ItemHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced fetch. Sort is part of the dependency list so flipping the
  // order re-queries (the server owns the ordering).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      setSearched(false);
      setError(null);
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, sort });
        const res = await fetch(
          `/api/pricing/items/search?${params.toString()}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Search failed (${res.status}).`);
        }
        const data: ItemHit[] = await res.json();
        setResults(data);
        setError(null);
        setSearched(true);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setResults([]);
          setError((err as Error).message || "Search failed.");
          setSearched(true);
        }
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, sort]);

  const goToProject = (hit: ItemHit) => {
    const ownerQuery =
      hit.ownerUserId != null ? `&owner=${hit.ownerUserId}` : "";
    router.push(
      `/pricing/manufacturer/${hit.manufacturerId}?project=${hit.projectId}${ownerQuery}`,
    );
  };

  // Quick summary across the current result set.
  const summary = useMemo(() => {
    if (results.length === 0) return null;
    const totalQty = results.reduce((a, r) => a + r.quantity, 0);
    const totalLanded = results.reduce((a, r) => a + r.landedCostTotal, 0);
    const prices = results.map((r) => r.unitLandedCost).filter((p) => p > 0);
    const minUnit = prices.length ? Math.min(...prices) : 0;
    const maxUnit = prices.length ? Math.max(...prices) : 0;
    const projectCount = new Set(results.map((r) => r.projectId)).size;
    return { totalQty, totalLanded, minUnit, maxUnit, projectCount };
  }, [results]);

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-10 sm:px-6">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/pricing"
          className="mb-4 flex w-fit items-center gap-1 text-sm text-gray-400 transition-colors hover:text-gray-700"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Dashboard
        </Link>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-cyan-600">
          <ScanSearch className="h-3.5 w-3.5" />
          Deep Search
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Item Cost Lookup
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Search a specific item to see what it cost you, when, and under
          which project — across every manufacturer you can see.
        </p>
      </div>

      {/* Search controls */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search an item model (e.g. cable, LED panel)…"
            className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-10 pr-10 text-sm text-gray-800 placeholder-gray-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/20"
          />
          {loading ? (
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              <Spinner size={14} />
            </span>
          ) : query ? (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {/* Sort */}
        <div className="relative flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 flex-shrink-0 text-gray-400" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-xl border border-gray-200 bg-white py-3 pl-3 pr-8 text-sm text-gray-700 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/20"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary strip */}
      {summary && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard label="Matches" value={String(results.length)} />
          <SummaryCard label="Projects" value={String(summary.projectCount)} />
          <SummaryCard label="Total qty" value={String(summary.totalQty)} />
          <SummaryCard
            label="Total landed cost"
            value={`${N(summary.totalLanded)} JOD`}
          />
        </div>
      )}

      {/* Results */}
      {error ? (
        <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {error}
        </div>
      ) : query.trim().length < 2 ? (
        <EmptyState
          icon={<ScanSearch className="h-9 w-9 text-gray-400" />}
          title="Type at least 2 characters"
          subtitle="Start typing an item model to look up its cost history."
        />
      ) : loading && results.length === 0 ? (
        <EmptyState
          icon={<Spinner size={28} />}
          title="Searching…"
          subtitle="Looking across every project you can see."
        />
      ) : searched && results.length === 0 ? (
        <EmptyState
          icon={<Package className="h-9 w-9 text-gray-400" />}
          title="No matching items"
          subtitle={`No line item matches “${query.trim()}”.`}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Project</th>
                  <th className="px-4 py-3">Manufacturer</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Unit cost (JOD)</th>
                  <th className="px-4 py-3 text-right">Total cost (JOD)</th>
                </tr>
              </thead>
              <tbody>
                {results.map((hit) => (
                  <tr
                    key={hit.lineId}
                    onClick={() => goToProject(hit)}
                    className="cursor-pointer border-b border-gray-50 transition-colors last:border-0 hover:bg-cyan-50/40"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800">
                        {hit.itemModel || (
                          <span className="italic text-gray-400">
                            (unnamed)
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-400">
                        ${N(hit.priceUsd)} USD / unit
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 font-medium text-gray-700">
                        {hit.projectName}
                        {(hit.parentProjectId != null ||
                          hit.revisionNumber > 1) && (
                          <span className="rounded-full bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">
                            v{hit.revisionNumber}
                          </span>
                        )}
                      </div>
                      {hit.responsiblePerson && (
                        <div className="mt-0.5 text-[11px] text-gray-400">
                          {hit.responsiblePerson}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-gray-600">
                        <Factory className="h-3.5 w-3.5 text-gray-400" />
                        {hit.manufacturerName}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {hit.date || (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                      {hit.quantity}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                      {N(hit.unitLandedCost)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-900">
                      {N(hit.landedCostTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
        {label}
      </div>
      <div className="mt-1 truncate text-lg font-bold text-gray-900">
        {value}
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-gray-200 bg-gray-50 py-20 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 ring-1 ring-gray-200">
        {icon}
      </div>
      <h3 className="mb-1 text-lg font-semibold text-gray-700">{title}</h3>
      <p className="text-sm text-gray-500">{subtitle}</p>
    </div>
  );
}
