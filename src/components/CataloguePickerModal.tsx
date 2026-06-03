"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QuotationItem } from "@/components/QuotationPreview";
import {
  toQuotationItem,
  type Product,
} from "@/components/QuickCatalogPicker";

interface SystemInfo {
  vendor: string;
  system: string;
  currency: string;
  product_count: number;
}

/**
 * In-designer catalogue PICKER overlay. Opens over the Quotation Designer from
 * the "+ Add from Catalogue" button so the user never leaves the editor: browse
 * a vendor/system or search across all vendors, then drop products straight
 * into the open quotation via `onAdd` (the Designer's addCatalogItem).
 *
 * Read-only by design — it shares the public `/api/catalogue/{systems,products}`
 * endpoints but never mutates the catalogue. Editing the catalogue itself lives
 * on the separate Catalogue Modifier page (/catalog), which is gated to storage
 * and admin.
 */
export default function CataloguePickerModal({
  existingPages,
  onAdd,
  onClose,
}: {
  existingPages: string[];
  onAdd: (item: QuotationItem) => void;
  onClose: () => void;
}) {
  const [systems, setSystems] = useState<SystemInfo[]>([]);
  const [systemsLoading, setSystemsLoading] = useState(true);
  const [selected, setSelected] = useState<{
    vendor: string;
    system: string;
  } | null>(null);

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);

  const [selectedPage, setSelectedPage] = useState(existingPages[0] ?? "");
  const [customPage, setCustomPage] = useState("");
  const [qty, setQty] = useState(1);
  const [justAdded, setJustAdded] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Escape closes the overlay.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Load the vendor/system list once on open.
  useEffect(() => {
    let cancelled = false;
    setSystemsLoading(true);
    fetch("/api/catalogue/systems", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { systems: [] }))
      .then((d) => {
        if (cancelled) return;
        const list: SystemInfo[] = Array.isArray(d)
          ? d
          : Array.isArray(d?.systems)
            ? d.systems
            : [];
        setSystems(list);
      })
      .catch(() => {
        if (!cancelled) setSystems([]);
      })
      .finally(() => {
        if (!cancelled) setSystemsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Fetch products whenever the user selects a system or types a search. A
  // search overrides the system selection (searches across every vendor).
  useEffect(() => {
    if (!debounced && !selected) {
      setProducts([]);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProductsLoading(true);
    const params = new URLSearchParams();
    if (debounced) {
      params.set("q", debounced);
    } else if (selected) {
      params.set("vendor", selected.vendor);
      params.set("system", selected.system);
    }
    params.set("limit", "300");
    fetch(`/api/catalogue/products?${params}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { products: [] }))
      .then((d) => {
        if (ctrl.signal.aborted) return;
        setProducts(Array.isArray(d.products) ? d.products : []);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") setProducts([]);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setProductsLoading(false);
      });
    return () => ctrl.abort();
  }, [debounced, selected]);

  const resolvedPage = useMemo(
    () => customPage.trim() || selectedPage.trim(),
    [customPage, selectedPage],
  );

  const handleAdd = useCallback(
    (p: Product) => {
      const page =
        resolvedPage || `${p.vendor} ${p.system}`.trim() || "General";
      onAdd(toQuotationItem(p, Math.max(1, qty), page));
      setJustAdded(p.id);
      window.setTimeout(
        () => setJustAdded((cur) => (cur === p.id ? null : cur)),
        900,
      );
    },
    [onAdd, qty, resolvedPage],
  );

  // Group vendor/system rows under their vendor for the left rail.
  const byVendor = useMemo(() => {
    const map = new Map<string, SystemInfo[]>();
    for (const s of systems) {
      const list = map.get(s.vendor) ?? [];
      list.push(s);
      map.set(s.vendor, list);
    }
    return Array.from(map.entries());
  }, [systems]);

  return (
    <div
      className="no-print fixed inset-0 z-[60] flex items-center justify-center bg-magic-ink/50 p-3 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Add from catalogue"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-magic-border px-5 py-3">
          <div>
            <h3 className="text-base font-bold text-magic-ink">
              Add from Catalogue
            </h3>
            <p className="text-xs text-magic-ink/60">
              Browse a system or search, then drop products straight into this
              quotation.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close catalogue"
            className="rounded-lg border border-magic-border px-3 py-1.5 text-sm font-semibold text-magic-ink/70 hover:bg-magic-soft"
          >
            Done
          </button>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-end gap-3 border-b border-magic-border/60 bg-magic-soft/30 px-5 py-3">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-[10px] font-semibold uppercase text-magic-ink/60">
              Search all vendors
            </label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search model, brand, keyword…"
              autoFocus
              className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-2 focus:ring-magic-red/20"
            />
          </div>
          <div className="min-w-[200px]">
            <label className="mb-1 block text-[10px] font-semibold uppercase text-magic-ink/60">
              Add to page
            </label>
            {existingPages.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1">
                {existingPages.map((p) => {
                  const active = !customPage && selectedPage === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setSelectedPage(p);
                        setCustomPage("");
                      }}
                      className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                        active
                          ? "border-magic-red bg-magic-red text-white"
                          : "border-magic-border bg-white hover:bg-magic-soft"
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            )}
            <input
              value={customPage}
              onChange={(e) => setCustomPage(e.target.value)}
              placeholder="…or a new page name"
              className="w-full rounded-lg border border-magic-border bg-white px-2.5 py-1.5 text-xs focus:border-magic-red focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase text-magic-ink/60">
              Qty
            </label>
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              className="w-16 rounded-lg border border-magic-border bg-white px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        {/* Body: system rail + product grid */}
        <div className="flex min-h-0 flex-1">
          {/* Left rail — vendors / systems */}
          <div className="hidden w-60 shrink-0 overflow-y-auto border-r border-magic-border/60 bg-white p-3 sm:block">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-magic-ink/50">
              Systems
            </div>
            {systemsLoading ? (
              <p className="px-1 text-xs text-magic-ink/50">Loading…</p>
            ) : byVendor.length === 0 ? (
              <p className="px-1 text-xs text-magic-ink/50">
                No systems in the catalogue yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {byVendor.map(([vendor, rows]) => (
                  <li key={vendor}>
                    <div className="px-1 text-[11px] font-bold text-magic-ink/80">
                      {vendor}
                    </div>
                    <ul className="mt-0.5">
                      {rows.map((s) => {
                        const active =
                          !debounced &&
                          selected?.vendor === s.vendor &&
                          selected?.system === s.system;
                        return (
                          <li key={`${s.vendor}:${s.system}`}>
                            <button
                              onClick={() => {
                                setQuery("");
                                setSelected({
                                  vendor: s.vendor,
                                  system: s.system,
                                });
                              }}
                              className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors ${
                                active
                                  ? "bg-magic-red/10 font-semibold text-magic-red"
                                  : "text-magic-ink/75 hover:bg-magic-soft"
                              }`}
                            >
                              <span className="truncate">
                                {s.system || "—"}
                              </span>
                              <span className="shrink-0 text-[10px] text-magic-ink/40">
                                {s.product_count}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Product grid */}
          <div className="min-h-0 flex-1 overflow-y-auto bg-magic-soft/20 p-4">
            {!debounced && !selected ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-magic-ink/50">
                Pick a system on the left, or search above, to browse products.
              </div>
            ) : productsLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-magic-ink/50">
                <span className="animate-pulse">Loading products…</span>
              </div>
            ) : products.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-magic-ink/50">
                {debounced
                  ? `No products match “${debounced}”.`
                  : "No products in this system."}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {products.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-col rounded-xl border border-magic-border bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <div className="flex gap-3">
                      {p.picture_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.picture_url}
                          alt={p.model}
                          className="h-16 w-16 shrink-0 rounded-md border border-magic-border/60 object-contain"
                        />
                      ) : (
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-magic-border/60 text-[9px] text-magic-ink/30">
                          no image
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-magic-ink">
                          {p.model || "—"}
                        </div>
                        <div className="truncate text-[11px] text-magic-ink/60">
                          {p.vendor}
                          {p.system ? ` · ${p.system}` : ""}
                        </div>
                        {p.price_si > 0 && (
                          <div className="mt-0.5 text-xs font-semibold text-magic-red">
                            {p.currency || "JOD"} {Number(p.price_si).toFixed(2)}
                          </div>
                        )}
                      </div>
                    </div>
                    {(p.description || p.fast_view) && (
                      <p className="mt-2 line-clamp-3 text-[11px] text-magic-ink/60">
                        {p.description || p.fast_view}
                      </p>
                    )}
                    <button
                      onClick={() => handleAdd(p)}
                      className={`mt-2 w-full rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                        justAdded === p.id
                          ? "bg-emerald-600 text-white"
                          : "bg-magic-red text-white hover:bg-red-700"
                      }`}
                    >
                      {justAdded === p.id
                        ? "Added ✓"
                        : `+ Add to ${resolvedPage || `${p.vendor} ${p.system}`.trim() || "page"}`}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
