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
  // Fields that carry metadata, not user-facing specs.
  const skip = new Set([
    "id",
    "model",
    "category",
    "sub_category",
    "pricing",
    "series",
    "vendor",
    "brand",
  ]);

  const parts: string[] = [];

  function formatLeaf(v: unknown): string | null {
    if (v === null || v === undefined || v === "" || v === false) return null;
    if (v === true) return "Yes";
    if (typeof v === "number" || typeof v === "string") return String(v);
    return null;
  }

  function walk(key: string, value: unknown) {
    if (value === null || value === undefined || value === "" || value === false)
      return;
    const label = key.replace(/_/g, " ");
    // Arrays render as comma-joined leaf values (filters out nested objects).
    if (Array.isArray(value)) {
      const items = value
        .map((v) => (typeof v === "object" && v !== null ? null : formatLeaf(v)))
        .filter((x): x is string => !!x);
      if (items.length) parts.push(`${label}: ${items.join(", ")}`);
      return;
    }
    // Nested objects get flattened so their leaf entries show up as top-level.
    if (typeof value === "object") {
      for (const [nk, nv] of Object.entries(value as Record<string, unknown>)) {
        walk(nk, nv);
      }
      return;
    }
    const formatted = formatLeaf(value);
    if (formatted) parts.push(`${label}: ${formatted}`);
  }

  for (const [k, v] of Object.entries(p)) {
    if (skip.has(k)) continue;
    walk(k, v);
  }

  return parts.join("  •  ");
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

// Suggested page names — users can also type their own.
const PAGE_SUGGESTIONS = [
  "CCTV",
  "Sound System",
  "Networking",
  "Access Control",
  "Intercom",
  "Cabling",
  "Display & Video Wall",
];

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
  const [globalMode, setGlobalMode] = useState(false);

  // ── Page-picker modal state ──────────────────────────────────────────────
  // When a product is clicked we park it here and pop a modal asking the
  // user which quotation page it should be added to. The user stays on the
  // catalog and only goes to the designer when they explicitly click the
  // "Open designer" button in the header.
  const [pendingItem, setPendingItem] = useState<HitWithSystem | null>(null);
  const [lastUsedPage, setLastUsedPage] = useState("");

  // ── Draft summary (items + existing page names already in the designer) ──
  const [draftCount, setDraftCount] = useState(0);
  const [existingPages, setExistingPages] = useState<string[]>([]);
  const refreshDraftSummary = useCallback(() => {
    const d = loadDraft();
    setDraftCount(d.items.length);
    const set = new Set<string>();
    for (const it of d.items) {
      if (it.system) set.add(it.system);
    }
    setExistingPages([...set]);
  }, []);
  useEffect(() => {
    refreshDraftSummary();
  }, [refreshDraftSummary]);

  // ── Debounce search ───────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // ── Fetch products ────────────────────────────────────────────────────────
  // - System selected → list/search within that system
  // - No system but a search term → run a global cross-vendor search
  // - Nothing selected and empty search → show prompt
  useEffect(() => {
    const hasSystem = !!systemId;
    const trimmed = debouncedSearch.trim();
    if (!hasSystem && !trimmed) {
      setHits([]);
      setGlobalMode(false);
      return;
    }
    setLoading(true);
    fetch("/api/database/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        hasSystem
          ? { systemId, text: trimmed || undefined, limit: 2000 }
          : { global: true, text: trimmed, limit: 200 },
      ),
    })
      .then((r) => r.json())
      .then((data) => {
        setHits(data.hits || []);
        setGlobalMode(data.mode === "global");
      })
      .catch(() => {
        setHits([]);
        setGlobalMode(false);
      })
      .finally(() => setLoading(false));
  }, [systemId, debouncedSearch]);

  // ── Dynamic visible columns ───────────────────────────────────────────────
  const columns = useMemo(() => {
    const CORE = globalMode
      ? ["vendor", "model", "category", "sub_category"]
      : ["model", "category", "sub_category"];
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
  }, [hits, globalMode]);

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

  // ── Open the page-picker modal for a selected product ───────────────────
  const openPagePicker = useCallback((h: HitWithSystem) => {
    setPendingItem(h);
  }, []);

  // ── Confirm the pending item's destination page and add it to the draft ─
  // Never navigates away — the user can keep selecting products.
  const confirmAddToPage = useCallback(
    (pageName: string, qty: number) => {
      if (!pendingItem) return;
      const trimmed = pageName.trim();
      if (!trimmed) return;
      const sys =
        systems.find((s) => s.id === systemId) || pendingItem.system;
      const item = toQuotationItem(pendingItem, sys, qty);
      item.system = trimmed;
      appendItem(item);
      setLastUsedPage(trimmed);
      setPendingItem(null);
      refreshDraftSummary();
    },
    [pendingItem, systems, systemId, refreshDraftSummary],
  );

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
            {systemId ? "Filter / search" : "Global search (all vendors)"}
          </label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              systemId
                ? "e.g. 4MP bullet ColorVu PoE"
                : "Search by keyword, model, vendor, category…"
            }
            className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
          />
        </div>

        <div className="pt-5">
          <button
            onClick={() => router.push("/designer")}
            disabled={draftCount === 0}
            className="relative rounded-lg bg-magic-red text-white px-4 py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              draftCount === 0
                ? "Select at least one product first"
                : "Finish and open the designer"
            }
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
        Pick a system to browse its full catalog, or just type in the search
        box to find products across <b>every vendor</b>. Click <b>+</b> on any
        product to add it to a quotation page. You stay on the catalog while
        you select — when you&apos;re done, click <b>Open designer</b> to
        review and edit the quotation.
      </p>

      {/* ── Product table ── */}
      <div className="flex-1 min-w-0">
        {!systemId && !debouncedSearch.trim() && (
          <div className="rounded-2xl border border-magic-border bg-white p-12 text-center text-magic-ink/40 text-sm">
            Select a system above to browse its full product catalog, or type
            in the global search box to find products across every vendor.
          </div>
        )}

        {loading && (
          <div className="rounded-2xl border border-magic-border bg-white p-12 text-center text-magic-ink/40 text-sm animate-pulse">
            {globalMode ? "Searching all vendors…" : "Loading products…"}
          </div>
        )}

        {!loading &&
          (systemId || debouncedSearch.trim()) &&
          sortedHits.length === 0 && (
            <div className="rounded-2xl border border-magic-border bg-white p-12 text-center text-magic-ink/40 text-sm">
              No products found{search ? ` for "${search}"` : ""}.
            </div>
          )}

        {pendingItem && (
          <PagePickerModal
            product={pendingItem}
            existingPages={existingPages}
            suggestions={PAGE_SUGGESTIONS}
            defaultPage={lastUsedPage}
            onCancel={() => setPendingItem(null)}
            onConfirm={confirmAddToPage}
          />
        )}

        {sortedHits.length > 0 && (
          <div className="rounded-2xl border border-magic-border bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-magic-border flex items-center justify-between">
              <span className="text-xs font-semibold text-magic-ink">
                {globalMode ? (
                  <>Global search results</>
                ) : (
                  <>
                    {currentSystem?.vendor} —{" "}
                    {currentSystem?.category || "All"}
                  </>
                )}
                <span className="ml-2 text-magic-ink/40 font-normal">
                  {sortedHits.length} products
                </span>
              </span>
            </div>
            <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-magic-soft/80 backdrop-blur z-10">
                  <tr>
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
                    return (
                      <tr
                        key={rowIdx}
                        className="border-t border-magic-border/50 hover:bg-magic-soft/30 transition-colors"
                      >
                        <td className="px-2 py-1.5">
                          <button
                            onClick={() => openPagePicker(h)}
                            title="Select which page to add this product to"
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
                          } else if (col === "vendor") {
                            val =
                              h.system?.vendor ||
                              h.system?.name ||
                              h.product.vendor ||
                              "";
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

// ─── Page picker modal ───────────────────────────────────────────────────────
// Pops up when the user clicks "+" on a product. Lets them pick one of the
// existing quotation pages, one of the suggested names, or type a new page
// name. Stays on the catalog after confirming so the user can keep picking.

function PagePickerModal({
  product,
  existingPages,
  suggestions,
  defaultPage,
  onCancel,
  onConfirm,
}: {
  product: HitWithSystem;
  existingPages: string[];
  suggestions: string[];
  defaultPage: string;
  onCancel: () => void;
  onConfirm: (pageName: string, qty: number) => void;
}) {
  const seeded =
    defaultPage || existingPages[0] || "";
  const [selected, setSelected] = useState(seeded);
  const [custom, setCustom] = useState("");
  const [qty, setQty] = useState(1);

  // Merge existing pages and suggestions (existing first, no dupes).
  const quickOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ name: string; existing: boolean }> = [];
    for (const p of existingPages) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push({ name: p, existing: true });
      }
    }
    for (const p of suggestions) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push({ name: p, existing: false });
      }
    }
    return out;
  }, [existingPages, suggestions]);

  const resolvedName = custom.trim() || selected;
  const canSubmit = resolvedName.length > 0 && qty > 0;

  function submit() {
    if (!canSubmit) return;
    onConfirm(resolvedName, qty);
  }

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-magic-ink">Add to which page?</h2>
        <p className="mt-1 text-xs text-magic-ink/60">
          <b>{String(product.product.model ?? "Product")}</b> will be added to
          the page you pick. You&apos;ll stay on the catalog so you can keep
          selecting.
        </p>

        <div className="mt-4">
          <div className="text-[10px] font-semibold uppercase text-magic-ink/60 mb-2">
            Pick a page
          </div>
          <div className="flex flex-wrap gap-2">
            {quickOptions.length === 0 && (
              <div className="text-[11px] text-magic-ink/40">
                No pages yet — type a name below.
              </div>
            )}
            {quickOptions.map((opt) => {
              const active = !custom && selected === opt.name;
              return (
                <button
                  key={opt.name}
                  type="button"
                  onClick={() => {
                    setSelected(opt.name);
                    setCustom("");
                  }}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    active
                      ? "bg-magic-red text-white border-magic-red"
                      : "bg-white border-magic-border hover:bg-magic-soft"
                  }`}
                >
                  {opt.name}
                  {opt.existing && (
                    <span
                      className={`ml-1 text-[9px] ${
                        active ? "text-white/80" : "text-magic-ink/40"
                      }`}
                    >
                      (existing)
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-[10px] font-semibold uppercase text-magic-ink/60 mb-1">
            Or type a new page name
          </label>
          <input
            autoFocus
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="e.g. Main Lobby CCTV"
            className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </div>

        <div className="mt-4">
          <label className="block text-[10px] font-semibold uppercase text-magic-ink/60 mb-1">
            Quantity
          </label>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
            className="w-24 rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
          />
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm text-magic-ink/70 hover:bg-magic-soft"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-lg bg-magic-red px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add to page
          </button>
        </div>
      </div>
    </div>
  );
}
