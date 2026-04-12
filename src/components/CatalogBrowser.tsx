"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/auth";
import {
  appendItem,
  loadDraft,
  loadEditingContext,
  type EditingContext,
} from "@/lib/quotationDraft";
import type { QuotationItem } from "@/components/QuotationPreview";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Product {
  id: number;
  vendor: string;
  system: string;
  category: string;
  sub_category: string;
  fast_view: string;
  model: string;
  description: string;
  currency: string;
  price_si: number;
  specifications: string;
}

interface SystemInfo {
  vendor: string;
  system: string;
  currency: string;
  product_count: number;
}

// ─── Form-control chrome ────────────────────────────────────────────────────
// Custom red chevron for <select> controls (replaces the ugly native triangle).
// Uses the brand red `#E2231A` so the indicator matches the rest of the palette.
const SELECT_CHEVRON_STYLE = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23E2231A'><path fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z' clip-rule='evenodd'/></svg>\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 0.75rem center",
  backgroundSize: "1rem",
} as const;

// ─── Fixed columns ──────────────────────────────────────────────────────────
// `width` is used as a table-layout:fixed column width so each column gets a
// predictable share of the table regardless of content length. Description
// and specifications get the most room because they are the only columns
// where extra width materially improves readability.

const DISPLAY_COLUMNS: Array<{
  key: keyof Product;
  label: string;
  width: string;
  wrap?: boolean;
}> = [
  { key: "vendor", label: "Vendor", width: "6%" },
  { key: "system", label: "System", width: "8%" },
  { key: "category", label: "Category", width: "8%" },
  { key: "sub_category", label: "Sub Category", width: "8%" },
  { key: "fast_view", label: "Fast View", width: "9%", wrap: true },
  { key: "model", label: "Model", width: "13%", wrap: true },
  { key: "description", label: "Description", width: "24%", wrap: true },
  { key: "currency", label: "Currency", width: "5%" },
  { key: "price_si", label: "Price SI", width: "7%" },
  { key: "specifications", label: "Specifications", width: "12%", wrap: true },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function toQuotationItem(p: Product, qty: number): QuotationItem {
  return {
    no: 0,
    system: `${p.vendor} ${p.system}`.trim(),
    brand: p.vendor,
    model: p.model,
    description: p.description || p.fast_view || `${p.category} ${p.sub_category}`.trim(),
    quantity: qty,
    unit_price: Number(p.price_si) || 0,
    delivery: "Available",
    picture_hint: p.category,
    price_si: Number(p.price_si) || 0,
  };
}

// ─── Suggested page names ───────────────────────────────────────────────────

const PAGE_SUGGESTIONS = [
  "CCTV",
  "Sound System",
  "Networking",
  "Access Control",
  "Intercom",
  "Cabling",
  "Display & Video Wall",
];

// ─── Main component ─────────────────────────────────────────────────────────

export default function CatalogBrowser({
  user: _user,
  initialSystems = [],
}: {
  user: SessionUser;
  /**
   * Pre-fetched vendor/system list supplied by the server page. When
   * provided, the dropdown is populated on first paint and we skip the
   * initial client fetch entirely — the old behaviour of mounting with an
   * empty select and waiting for /api/catalogue/systems (with retry
   * back-off) caused a noticeable lag on cold starts.
   */
  initialSystems?: SystemInfo[];
}) {
  const router = useRouter();

  // ── System list ──────────────────────────────────────────────────────────
  const [systems, setSystems] = useState<SystemInfo[]>(initialSystems);
  useEffect(() => {
    // If the server already hydrated the list, skip the round-trip.
    if (initialSystems && initialSystems.length > 0) return;
    let cancelled = false;
    async function load(attempt = 0): Promise<void> {
      try {
        const r = await fetch("/api/catalogue/systems");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (!cancelled) setSystems(d.systems || []);
      } catch {
        // Retry up to 2 times (3 total) with short back-off — covers cold-start
        // races where the first request may hit a still-initialising DB pool.
        if (attempt < 2 && !cancelled) {
          await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
          return load(attempt + 1);
        }
        if (!cancelled) setSystems([]);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [initialSystems]);

  // ── Browsing state ────────────────────────────────────────────────────────
  const [selectedVendor, setSelectedVendor] = useState("");
  const [selectedSystem, setSelectedSystem] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<keyof Product>("model");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [globalMode, setGlobalMode] = useState(false);
  const [selectedSubCategory, setSelectedSubCategory] = useState("");

  // ── Page-picker modal ───────────────────────────────────────────────────
  const [pendingItem, setPendingItem] = useState<Product | null>(null);
  const [lastUsedPage, setLastUsedPage] = useState("");

  // ── Draft summary ──────────────────────────────────────────────────────
  const [draftCount, setDraftCount] = useState(0);
  const [existingPages, setExistingPages] = useState<string[]>([]);
  const [editing, setEditing] = useState<EditingContext | null>(null);

  const refreshDraftSummary = useCallback(() => {
    const d = loadDraft();
    setDraftCount(d.items.length);
    const set = new Set<string>();
    for (const it of d.items) {
      if (it.system) set.add(it.system);
    }
    setExistingPages([...set]);
    setEditing(loadEditingContext());
  }, []);

  useEffect(() => {
    refreshDraftSummary();
  }, [refreshDraftSummary]);

  // ── Debounce ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // ── Fetch products ────────────────────────────────────────────────────────
  useEffect(() => {
    const hasSystem = !!selectedVendor;
    const trimmed = debouncedSearch.trim();
    if (!hasSystem && !trimmed) {
      setProducts([]);
      setTotal(0);
      setGlobalMode(false);
      return;
    }

    setLoading(true);
    const params = new URLSearchParams();
    if (selectedVendor) params.set("vendor", selectedVendor);
    if (selectedSystem) params.set("system", selectedSystem);
    if (trimmed) params.set("q", trimmed);
    params.set("limit", "2000");

    fetch(`/api/catalogue/products?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setProducts(data.products || []);
        setTotal(data.total || 0);
        setGlobalMode(!selectedVendor && !!trimmed);
      })
      .catch(() => {
        setProducts([]);
        setTotal(0);
        setGlobalMode(false);
      })
      .finally(() => setLoading(false));
  }, [selectedVendor, selectedSystem, debouncedSearch]);

  // ── Categories derived from loaded products (for the filter dropdown) ───────
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.category) set.add(p.category);
    }
    return [...set].sort();
  }, [products]);

  // Reset category filter when the available list no longer contains it
  useEffect(() => {
    if (selectedSubCategory && !categories.includes(selectedSubCategory)) {
      setSelectedSubCategory("");
    }
  }, [categories, selectedSubCategory]);

  // ── Sorted products (with optional category filter) ───────────────────────
  const sorted = useMemo(() => {
    const base = selectedSubCategory
      ? products.filter((p) => p.category === selectedSubCategory)
      : products;
    return [...base].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av ?? "").localeCompare(String(bv ?? ""))
        : String(bv ?? "").localeCompare(String(av ?? ""));
    });
  }, [products, selectedSubCategory, sortKey, sortDir]);

  function toggleSort(key: keyof Product) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // ── Page picker ───────────────────────────────────────────────────────────
  const confirmAddToPage = useCallback(
    (pageName: string, qty: number) => {
      if (!pendingItem) return;
      const trimmed = pageName.trim();
      if (!trimmed) return;
      const item = toQuotationItem(pendingItem, qty);
      item.system = trimmed;
      appendItem(item);
      setLastUsedPage(trimmed);
      setPendingItem(null);
      refreshDraftSummary();
    },
    [pendingItem, refreshDraftSummary],
  );

  // ── Systems grouped by vendor ─────────────────────────────────────────────
  const systemsByVendor = useMemo(() => {
    const map = new Map<string, SystemInfo[]>();
    for (const s of systems) {
      if (!map.has(s.vendor)) map.set(s.vendor, []);
      map.get(s.vendor)!.push(s);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [systems]);

  // ── Expanded specs state ──────────────────────────────────────────────────
  const [expandedSpec, setExpandedSpec] = useState<number | null>(null);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-48">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-magic-ink/60 mb-1">
            Select vendor / system
          </label>
          <select
            value={selectedVendor ? `${selectedVendor}||${selectedSystem}` : ""}
            onChange={(e) => {
              const val = e.target.value;
              if (!val) {
                setSelectedVendor("");
                setSelectedSystem("");
              } else {
                const [v, s] = val.split("||");
                setSelectedVendor(v);
                setSelectedSystem(s || "");
              }
              setSearch("");
              setSelectedSubCategory("");
              setProducts([]);
            }}
            style={SELECT_CHEVRON_STYLE}
            className="w-full appearance-none rounded-lg border border-magic-border bg-white pl-3 pr-9 py-2.5 text-sm font-medium text-magic-ink shadow-sm cursor-pointer hover:border-magic-red/50 hover:bg-magic-soft/40 focus:outline-none focus:border-magic-red focus:ring-2 focus:ring-magic-red/20 transition-all"
          >
            <option value="">— Pick a system —</option>
            {systemsByVendor.map(([vendor, list]) => (
              <optgroup key={vendor} label={vendor}>
                {list.map((s, i) => (
                  <option key={`${vendor}-${i}`} value={`${s.vendor}||${s.system}`}>
                    {s.system || s.vendor} — {s.product_count} products
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {categories.length > 0 && (
          <div className="flex-1 min-w-40 max-w-56">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-magic-ink/60 mb-1">
              Sub Category
            </label>
            <select
              value={selectedSubCategory}
              onChange={(e) => setSelectedSubCategory(e.target.value)}
              style={SELECT_CHEVRON_STYLE}
              className="w-full appearance-none rounded-lg border border-magic-border bg-white pl-3 pr-9 py-2.5 text-sm font-medium text-magic-ink shadow-sm cursor-pointer hover:border-magic-red/50 hover:bg-magic-soft/40 focus:outline-none focus:border-magic-red focus:ring-2 focus:ring-magic-red/20 transition-all"
            >
              <option value="">— All sub categories —</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex-1 min-w-48">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-magic-ink/60 mb-1">
            {selectedVendor ? "Filter / search" : "Global search (all vendors)"}
          </label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              selectedVendor
                ? "e.g. 4MP bullet ColorVu PoE"
                : "Search by keyword, model, vendor, category…"
            }
            className="w-full rounded-lg border border-magic-border bg-white px-3 py-2.5 text-sm font-medium text-magic-ink shadow-sm placeholder:text-magic-ink/30 hover:border-magic-red/50 hover:bg-magic-soft/40 focus:outline-none focus:border-magic-red focus:ring-2 focus:ring-magic-red/20 transition-all"
          />
        </div>

        <div className="pt-5">
          <button
            onClick={() =>
              router.push(editing ? `/designer?id=${editing.id}` : "/designer")
            }
            disabled={!editing && draftCount === 0}
            className="relative rounded-lg bg-magic-red text-white px-4 py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              editing
                ? `Return to editing ${editing.ref}`
                : draftCount === 0
                  ? "Select at least one product first"
                  : "Finish and open the designer"
            }
          >
            {editing ? "Back to editor" : "Open designer"}
            {draftCount > 0 && (
              <span className="absolute -top-2 -right-2 bg-white text-magic-red border border-magic-red text-[10px] rounded-full w-5 h-5 flex items-center justify-center font-bold">
                {draftCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {editing && (
        <div className="-mt-2 flex items-center justify-between gap-3 rounded-lg border border-magic-red/40 bg-magic-red/5 px-3 py-2 text-[11px] text-magic-ink">
          <div>
            <b>Editing {editing.ref}</b>
            {editing.projectName && (
              <span className="text-magic-ink/60"> — {editing.projectName}</span>
            )}
            .{" "}
            <span className="text-magic-ink/70">
              Products you pick here will be appended to that quotation
              {draftCount > 0 && (
                <>
                  {" "}
                  — <b>{draftCount}</b> queued
                </>
              )}
              .
            </span>
          </div>
          <button
            onClick={() => router.push(`/designer?id=${editing.id}`)}
            className="shrink-0 rounded-md border border-magic-red bg-white px-3 py-1 text-[11px] font-semibold text-magic-red hover:bg-magic-red hover:text-white"
          >
            Back to editor →
          </button>
        </div>
      )}

      <p className="text-[11px] text-magic-ink/60 -mt-2">
        Pick a system to browse its full catalogue, or just type in the search
        box to find products across <b>every vendor</b>. Click <b>+</b> on any
        product to add it to a quotation page. You stay on the catalogue while
        you select — when you&apos;re done, click{" "}
        <b>{editing ? "Back to editor" : "Open designer"}</b> to review and
        edit the quotation.
      </p>

      {/* ── Product table ── */}
      <div className="flex-1 min-w-0">
        {!selectedVendor && !debouncedSearch.trim() && (
          <div className="rounded-2xl border border-magic-border bg-white p-12 text-center text-magic-ink/40 text-sm">
            Select a system above to browse its full product catalogue, or type
            in the global search box to find products across every vendor.
          </div>
        )}

        {loading && (
          <div className="rounded-2xl border border-magic-border bg-white p-12 text-center text-magic-ink/40 text-sm animate-pulse">
            {globalMode ? "Searching all vendors…" : "Loading products…"}
          </div>
        )}

        {!loading &&
          (selectedVendor || debouncedSearch.trim()) &&
          sorted.length === 0 && (
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

        {sorted.length > 0 && (
          <div className="rounded-2xl border border-magic-border bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-magic-border flex items-center justify-between">
              <span className="text-xs font-semibold text-magic-ink">
                {globalMode ? (
                  <>Global search results</>
                ) : (
                  <>
                    {selectedVendor} — {selectedSystem || "All"}
                  </>
                )}
                <span className="ml-2 text-magic-ink/40 font-normal">
                  {sorted.length} of {total} products
                </span>
              </span>
            </div>
            <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
              <table className="w-full text-xs border-collapse table-fixed">
                <colgroup>
                  <col style={{ width: "32px" }} />
                  {DISPLAY_COLUMNS.map((col) => (
                    <col key={col.key} style={{ width: col.width }} />
                  ))}
                </colgroup>
                <thead className="sticky top-0 bg-magic-soft/80 backdrop-blur z-10">
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold text-magic-ink/60"></th>
                    {DISPLAY_COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        onClick={() => toggleSort(col.key)}
                        className="px-2 py-2 text-left font-semibold text-magic-ink/60 cursor-pointer hover:text-magic-red select-none"
                      >
                        <span className="inline-flex items-center gap-1">
                          <span className="truncate">{col.label}</span>
                          {sortKey === col.key && (
                            <span>{sortDir === "asc" ? "↑" : "↓"}</span>
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p) => (
                    <tr
                      key={p.id}
                      className="border-t border-magic-border/50 hover:bg-magic-soft/30 transition-colors"
                    >
                      <td className="px-2 py-1.5">
                        <button
                          onClick={() => setPendingItem(p)}
                          title="Add to quotation"
                          aria-label="Add product to quotation"
                          className="w-7 h-7 rounded-full bg-magic-red text-white flex items-center justify-center shadow-sm shadow-magic-red/30 hover:bg-red-700 hover:scale-110 hover:shadow-md hover:shadow-magic-red/40 active:scale-95 focus:outline-none focus:ring-2 focus:ring-magic-red/40 focus:ring-offset-1 transition-all duration-150"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className="w-4 h-4"
                            aria-hidden="true"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H5a1 1 0 110-2h4V5a1 1 0 011-1z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </td>
                      {DISPLAY_COLUMNS.map((col) => {
                        const val = p[col.key];
                        let display: string;
                        if (col.key === "price_si") {
                          const raw = Number(val);
                          display =
                            raw > 0
                              ? `${p.currency} ${raw.toFixed(2)}`
                              : "—";
                        } else if (col.key === "specifications") {
                          const s = String(val || "");
                          const isExpanded = expandedSpec === p.id;
                          display = isExpanded
                            ? s
                            : s.length > 60
                              ? s.slice(0, 60) + "…"
                              : s;
                        } else {
                          display =
                            val === null || val === undefined || val === ""
                              ? "—"
                              : String(val);
                        }
                        const rawTitle =
                          val === null || val === undefined || val === ""
                            ? undefined
                            : String(val);
                        return (
                          <td
                            key={col.key}
                            className={`px-2 py-1.5 align-top ${
                              col.wrap
                                ? "whitespace-normal break-words"
                                : "truncate whitespace-nowrap"
                            } ${
                              col.key === "model"
                                ? "font-semibold text-magic-ink"
                                : col.key === "price_si"
                                  ? "text-magic-red font-semibold whitespace-nowrap"
                                  : "text-magic-ink/70"
                            }`}
                            onClick={
                              col.key === "specifications"
                                ? () =>
                                    setExpandedSpec(
                                      expandedSpec === p.id ? null : p.id,
                                    )
                                : undefined
                            }
                            title={
                              col.key === "specifications"
                                ? "Click to expand/collapse"
                                : rawTitle
                            }
                            style={
                              col.key === "specifications"
                                ? { cursor: "pointer" }
                                : undefined
                            }
                          >
                            {display}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
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

function PagePickerModal({
  product,
  existingPages,
  suggestions,
  defaultPage,
  onCancel,
  onConfirm,
}: {
  product: Product;
  existingPages: string[];
  suggestions: string[];
  defaultPage: string;
  onCancel: () => void;
  onConfirm: (pageName: string, qty: number) => void;
}) {
  const seeded = defaultPage || existingPages[0] || "";
  const [selected, setSelected] = useState(seeded);
  const [custom, setCustom] = useState("");
  const [qty, setQty] = useState(1);

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
          <b>{product.model || "Product"}</b> will be added to the page you
          pick. You&apos;ll stay on the catalogue so you can keep selecting.
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
