"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { SystemEntry } from "@/lib/manifest.generated";
import type { SessionUser } from "@/lib/auth";
import type { ScoredProduct } from "@/lib/search";
import { appendItem, loadDraft } from "@/lib/quotationDraft";
import type { QuotationItem } from "@/components/QuotationPreview";

// ─── Types ──────────────────────────────────────────────────────────────────

interface HitWithSystem extends ScoredProduct {
  system?: SystemEntry;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getPrice(p: Record<string, unknown>): { si: number; dpp: number } {
  const pr = (p.pricing || {}) as Record<string, unknown>;
  return {
    si: typeof pr.si === "number" ? pr.si : typeof pr.price === "number" ? pr.price : 0,
    dpp: typeof pr.dpp === "number" ? pr.dpp : 0,
  };
}

function flatSpecs(p: Record<string, unknown>): string {
  const skip = new Set(["id", "model", "category", "sub_category", "pricing", "series"]);
  return Object.entries(p)
    .filter(([k, v]) => !skip.has(k) && v !== null && v !== undefined && v !== "" && v !== false)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
    .join("  •  ");
}

function sortVal(product: Record<string, unknown>, key: string, unitPrice: number): string | number {
  if (key === "si_price") return unitPrice;
  if (key === "dpp_price") return getPrice(product).dpp;
  const v = product[key];
  if (typeof v === "number") return v;
  return String(v ?? "");
}

function systemLabel(sys: SystemEntry | undefined): string {
  if (!sys) return "General";
  return `${sys.vendor} ${sys.category || ""}`.trim();
}

function toQuotationItem(
  h: HitWithSystem,
  sys: SystemEntry | undefined,
  qty: number,
): QuotationItem {
  return {
    no: 0, // renumbered by appendItem
    system: systemLabel(sys),
    brand: sys?.vendor ?? "",
    model: String(h.product.model ?? ""),
    description: flatSpecs(h.product),
    quantity: qty,
    unit_price: h.unitPrice,
    delivery: "Available",
    picture_hint: String(h.product.form_factor ?? h.product.category ?? ""),
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CatalogBrowser({
  systems,
  user: _user,
}: {
  systems: SystemEntry[];
  user: SessionUser;
}) {
  const router = useRouter();

  // ── Browsing state ────────────────────────────────────────────────────────
  const [systemId, setSystemId] = useState<number | "">("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [hits, setHits] = useState<HitWithSystem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState("model");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // ── Multi-select state (bulk "move to designer") ─────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Draft summary (items already in the designer) ────────────────────────
  const [draftCount, setDraftCount] = useState(0);
  useEffect(() => {
    setDraftCount(loadDraft().items.length);
  }, []);

  // ── Debounce search ───────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // ── Fetch products ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!systemId) {
      setHits([]);
      return;
    }
    setLoading(true);
    fetch("/api/database/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemId,
        text: debouncedSearch || undefined,
        limit: 2000,
      }),
    })
      .then((r) => r.json())
      .then((data) => setHits(data.hits || []))
      .catch(() => setHits([]))
      .finally(() => setLoading(false));
  }, [systemId, debouncedSearch]);

  // Clear selection whenever the current system changes, so you don't
  // accidentally carry leftovers from a different vendor into the designer.
  useEffect(() => {
    setSelected(new Set());
  }, [systemId]);

  // Stable key per catalog hit — system + model is enough to dedupe.
  const keyOf = useCallback(
    (h: HitWithSystem): string =>
      `${systemId}__${String(h.product.model ?? "")}`,
    [systemId],
  );

  // ── Dynamic visible columns ───────────────────────────────────────────────
  const columns = useMemo(() => {
    const CORE = ["model", "category", "sub_category"];
    const ALWAYS_SKIP = new Set(["id", "pricing", "series"]);
    const extra = new Set<string>();
    for (const h of hits.slice(0, 50)) {
      for (const k of Object.keys(h.product)) {
        if (!ALWAYS_SKIP.has(k) && !CORE.includes(k)) extra.add(k);
      }
    }
    const sortedExtra = [...extra].sort((a, b) => {
      const av = hits[0]?.product[a];
      const bv = hits[0]?.product[b];
      const aIsNum = typeof av === "number";
      const bIsNum = typeof bv === "number";
      const aIsBool = typeof av === "boolean";
      const bIsBool = typeof bv === "boolean";
      if (aIsBool && !bIsBool) return 1;
      if (!aIsBool && bIsBool) return -1;
      if (aIsNum && !bIsNum) return -1;
      if (!aIsNum && bIsNum) return 1;
      return a.localeCompare(b);
    });
    return [...CORE, ...sortedExtra, "si_price", "dpp_price"];
  }, [hits]);

  // ── Sorted hits ───────────────────────────────────────────────────────────
  const sortedHits = useMemo(() => {
    return [...hits].sort((a, b) => {
      const av = sortVal(a.product, sortKey, a.unitPrice);
      const bv = sortVal(b.product, sortKey, b.unitPrice);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [hits, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // ── Add item → push to draft, then go straight to the designer ───────────
  const addAndGoToDesigner = useCallback(
    (h: HitWithSystem, qty = 1) => {
      const sys = systems.find((s) => s.id === systemId) || h.system;
      appendItem(toQuotationItem(h, sys, qty));
      router.push("/designer");
    },
    [router, systemId, systems],
  );

  // ── Add without navigating (for accumulating multiple in one trip) ───────
  const addSilently = useCallback(
    (h: HitWithSystem, qty = 1) => {
      const sys = systems.find((s) => s.id === systemId) || h.system;
      const d = appendItem(toQuotationItem(h, sys, qty));
      setDraftCount(d.items.length);
    },
    [systemId, systems],
  );

  // ── Selection helpers ────────────────────────────────────────────────────
  const toggleSelect = useCallback((k: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  // ── Bulk: add every selected hit to the draft, then go to designer ───────
  const addSelectedAndGo = useCallback(() => {
    if (selected.size === 0) return;
    const sys = systems.find((s) => s.id === systemId);
    let lastCount = draftCount;
    for (const h of hits) {
      if (selected.has(keyOf(h))) {
        const d = appendItem(toQuotationItem(h, sys || h.system, 1));
        lastCount = d.items.length;
      }
    }
    setDraftCount(lastCount);
    setSelected(new Set());
    router.push("/designer");
  }, [hits, selected, systemId, systems, keyOf, draftCount, router]);

  // ── Systems grouped by vendor ─────────────────────────────────────────────
  const systemsByVendor = useMemo(() => {
    const map = new Map<string, SystemEntry[]>();
    for (const s of systems) {
      if (!map.has(s.vendor)) map.set(s.vendor, []);
      map.get(s.vendor)!.push(s);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [systems]);

  const currentSystem = systems.find((s) => s.id === systemId);

  const allVisibleSelected =
    sortedHits.length > 0 && sortedHits.every((h) => selected.has(keyOf(h)));
  const someVisibleSelected =
    !allVisibleSelected && sortedHits.some((h) => selected.has(keyOf(h)));

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        sortedHits.forEach((h) => next.delete(keyOf(h)));
      } else {
        sortedHits.forEach((h) => next.add(keyOf(h)));
      }
      return next;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-48">
          <label className="block text-[10px] font-semibold uppercase text-magic-ink/60 mb-1">
            Select system / vendor
          </label>
          <select
            value={systemId}
            onChange={(e) => {
              setSystemId(e.target.value ? Number(e.target.value) : "");
              setSearch("");
              setHits([]);
            }}
            className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
          >
            <option value="">— Pick a system —</option>
            {systemsByVendor.map(([vendor, list]) => (
              <optgroup key={vendor} label={vendor}>
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.category || s.vendor} — {s.productCount} products
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-48">
          <label className="block text-[10px] font-semibold uppercase text-magic-ink/60 mb-1">
            Filter / search
          </label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. 4MP bullet ColorVu PoE"
            disabled={!systemId}
            className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm disabled:opacity-40"
          />
        </div>

        <div className="pt-5 flex gap-2">
          <button
            onClick={addSelectedAndGo}
            disabled={selected.size === 0}
            className="rounded-lg bg-magic-ink text-white px-4 py-2 text-sm font-semibold hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed"
            title="Move every ticked product to the designer in one shot"
          >
            Move {selected.size > 0 ? `${selected.size} ` : ""}selected →
            designer
          </button>
          <button
            onClick={() => router.push("/designer")}
            className="relative rounded-lg bg-magic-red text-white px-4 py-2 text-sm font-semibold hover:bg-red-700"
          >
            Open designer
            {draftCount > 0 && (
              <span className="absolute -top-2 -right-2 bg-white text-magic-red border border-magic-red text-[10px] rounded-full w-5 h-5 flex items-center justify-center font-bold">
                {draftCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <p className="text-[11px] text-magic-ink/60 -mt-2">
        Tick the checkboxes to batch‑select products, then press{" "}
        <b>Move selected → designer</b> to push them all at once. You can also
        click <b>+</b> on a single row to jump straight into the designer, or
        hold{" "}
        <kbd className="px-1 py-0.5 rounded bg-magic-soft border border-magic-border">
          Shift
        </kbd>{" "}
        while clicking <b>+</b> to add one without leaving the catalog.
      </p>

      {/* ── Product table ── */}
      <div className="flex-1 min-w-0">
        {!systemId && (
          <div className="rounded-2xl border border-magic-border bg-white p-12 text-center text-magic-ink/40 text-sm">
            Select a system above to browse its full product catalog.
          </div>
        )}

        {systemId && loading && (
          <div className="rounded-2xl border border-magic-border bg-white p-12 text-center text-magic-ink/40 text-sm animate-pulse">
            Loading products…
          </div>
        )}

        {systemId && !loading && sortedHits.length === 0 && (
          <div className="rounded-2xl border border-magic-border bg-white p-12 text-center text-magic-ink/40 text-sm">
            No products found{search ? ` for "${search}"` : ""}.
          </div>
        )}

        {sortedHits.length > 0 && (
          <div className="rounded-2xl border border-magic-border bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-magic-border flex items-center justify-between">
              <span className="text-xs font-semibold text-magic-ink">
                {currentSystem?.vendor} — {currentSystem?.category || "All"}
                <span className="ml-2 text-magic-ink/40 font-normal">
                  {sortedHits.length} products
                </span>
              </span>
              {selected.size > 0 && (
                <span className="text-[11px] text-magic-ink/60">
                  {selected.size} selected{" "}
                  <button
                    onClick={() => setSelected(new Set())}
                    className="ml-1 underline hover:text-magic-red"
                  >
                    clear
                  </button>
                </span>
              )}
            </div>
            <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-magic-soft/80 backdrop-blur z-10">
                  <tr>
                    <th className="px-2 py-2 text-center font-semibold text-magic-ink/60 w-8">
                      <input
                        type="checkbox"
                        aria-label="Select all visible products"
                        checked={allVisibleSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someVisibleSelected;
                        }}
                        onChange={toggleSelectAllVisible}
                        className="cursor-pointer"
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-magic-ink/60 w-8"></th>
                    {columns.map((col) => (
                      <th
                        key={col}
                        onClick={() => toggleSort(col)}
                        className="px-3 py-2 text-left font-semibold text-magic-ink/60 whitespace-nowrap cursor-pointer hover:text-magic-red select-none"
                      >
                        {col === "si_price"
                          ? "SI Price"
                          : col === "dpp_price"
                            ? "DPP Price"
                            : col.replace(/_/g, " ")}
                        {sortKey === col && (
                          <span className="ml-1">
                            {sortDir === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedHits.map((h, rowIdx) => {
                    const prices = getPrice(h.product);
                    const k = keyOf(h);
                    const isSelected = selected.has(k);
                    return (
                      <tr
                        key={rowIdx}
                        className={`border-t border-magic-border/50 transition-colors ${
                          isSelected
                            ? "bg-magic-soft/70"
                            : "hover:bg-magic-soft/30"
                        }`}
                      >
                        <td className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(k)}
                            aria-label={`Select ${String(h.product.model ?? "")}`}
                            className="cursor-pointer"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <button
                            onClick={(e) => {
                              if (e.shiftKey) addSilently(h);
                              else addAndGoToDesigner(h);
                            }}
                            title="Add to designer (Shift+click to stay on catalog)"
                            className="w-6 h-6 rounded-full bg-magic-red text-white flex items-center justify-center text-base leading-none hover:bg-red-700 font-bold"
                          >
                            +
                          </button>
                        </td>
                        {columns.map((col) => {
                          let val: unknown;
                          if (col === "si_price") {
                            val =
                              prices.si > 0
                                ? `${h.currency} ${prices.si.toFixed(2)}`
                                : "—";
                          } else if (col === "dpp_price") {
                            val =
                              prices.dpp > 0
                                ? `${h.currency} ${prices.dpp.toFixed(2)}`
                                : "—";
                          } else {
                            val = h.product[col];
                          }
                          const display =
                            val === null || val === undefined || val === ""
                              ? "—"
                              : val === true
                                ? "✓"
                                : val === false
                                  ? ""
                                  : String(val);
                          return (
                            <td
                              key={col}
                              className={`px-3 py-1.5 whitespace-nowrap ${
                                col === "model"
                                  ? "font-semibold text-magic-ink"
                                  : val === true
                                    ? "text-green-600 font-medium"
                                    : col === "si_price" ||
                                        col === "dpp_price"
                                      ? "text-magic-red font-semibold"
                                      : "text-magic-ink/70"
                              }`}
                            >
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
