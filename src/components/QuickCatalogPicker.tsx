"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QuotationItem } from "@/components/QuotationPreview";

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
  picture_url?: string | null;
}

interface Props {
  /**
   * Existing page / system names from the current draft. Surfaced as quick
   * buttons so the user doesn't have to retype "CCTV", "KNX Lighting" etc.
   * on every add.
   */
  existingPages: string[];
  /** Invoked once the user has picked a product, page and quantity. */
  onAdd: (item: QuotationItem) => void;
  /** Optional CSS class forwarded to the root container. */
  className?: string;
}

function toQuotationItem(p: Product, qty: number, page: string): QuotationItem {
  return {
    no: 0,
    system: page.trim() || `${p.vendor} ${p.system}`.trim() || "General",
    brand: p.vendor,
    model: p.model,
    description:
      p.description ||
      p.fast_view ||
      `${p.category} ${p.sub_category}`.trim() ||
      "",
    quantity: qty,
    unit_price: Number(p.price_si) || 0,
    delivery: "Available",
    picture_hint: p.category,
    // Carry the catalogue thumbnail straight onto the quotation item so
    // the Designer's PictureCell shows it the moment "Include image" is
    // toggled on, without the user having to re-upload per row. Mirrors
    // the same wiring in CatalogBrowser.toQuotationItem.
    picture_url: p.picture_url || undefined,
    price_si: Number(p.price_si) || 0,
  };
}

/**
 * Compact catalogue search + add sidebar shown next to the Quotation
 * preview. Kept deliberately lightweight — it shares the public
 * `/api/catalogue/products` endpoint with `/catalog` but renders only the
 * minimum a user needs to spot and drop a product into the active draft
 * without leaving the Designer page.
 */
export default function QuickCatalogPicker({
  existingPages,
  onAdd,
  className,
}: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [qty, setQty] = useState(1);
  const [selectedPage, setSelectedPage] = useState<string>("");
  const [customPage, setCustomPage] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Keep the default page in sync with whatever pages already exist so the
  // first product the user adds lands in a sensible spot.
  useEffect(() => {
    if (!selectedPage && existingPages.length > 0) {
      setSelectedPage(existingPages[0]);
    }
  }, [existingPages, selectedPage]);

  // Debounce search input — avoids hammering the products endpoint on every
  // keystroke while the user is still typing.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debounced) {
      setProducts([]);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    const params = new URLSearchParams();
    params.set("q", debounced);
    params.set("limit", "25");
    fetch(`/api/catalogue/products?${params}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { products: [] }))
      .then((d) => {
        if (ctrl.signal.aborted) return;
        setProducts(Array.isArray(d.products) ? d.products : []);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setProducts([]);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [debounced]);

  const resolvedPage = useMemo(
    () => customPage.trim() || selectedPage.trim(),
    [customPage, selectedPage],
  );

  const handleAdd = useCallback(
    (p: Product) => {
      const page = resolvedPage || `${p.vendor} ${p.system}`.trim() || "General";
      onAdd(toQuotationItem(p, Math.max(1, qty), page));
    },
    [onAdd, qty, resolvedPage],
  );

  if (collapsed) {
    return (
      <aside
        className={`no-print flex flex-col items-center gap-3 rounded-2xl border border-magic-border bg-white p-3 ${className ?? ""}`}
      >
        <button
          onClick={() => setCollapsed(false)}
          title="Show quick catalogue picker"
          className="rounded-md border border-magic-red text-magic-red px-2 py-1 text-[11px] font-semibold hover:bg-magic-red hover:text-white"
        >
          ◀ Catalogue
        </button>
      </aside>
    );
  }

  return (
    <aside
      className={`no-print flex flex-col gap-3 rounded-2xl border border-magic-border bg-white p-4 ${className ?? ""}`}
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-magic-ink">Quick catalogue</h4>
        <button
          onClick={() => setCollapsed(true)}
          title="Collapse picker"
          className="text-magic-ink/50 hover:text-magic-red text-xs"
        >
          ✕
        </button>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search model, brand, keyword…"
        className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm placeholder:text-magic-ink/30 focus:outline-none focus:border-magic-red focus:ring-2 focus:ring-magic-red/20"
      />

      <div>
        <label className="block text-[10px] font-semibold uppercase text-magic-ink/60 mb-1">
          Add to page
        </label>
        {existingPages.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5">
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
                      ? "bg-magic-red text-white border-magic-red"
                      : "bg-white border-magic-border hover:bg-magic-soft"
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
          placeholder="…or type a new page name"
          className="w-full rounded-lg border border-magic-border bg-white px-2.5 py-1.5 text-xs placeholder:text-magic-ink/30 focus:outline-none focus:border-magic-red"
        />
      </div>

      <div>
        <label className="block text-[10px] font-semibold uppercase text-magic-ink/60 mb-1">
          Quantity
        </label>
        <input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          className="w-20 rounded-lg border border-magic-border bg-white px-2 py-1 text-xs"
        />
      </div>

      <div className="flex-1 min-h-[120px] max-h-[50vh] overflow-y-auto border-t border-magic-border/60 pt-2">
        {!debounced && (
          <p className="text-[11px] text-magic-ink/50 text-center py-4">
            Type a keyword above to search the catalogue.
          </p>
        )}
        {debounced && loading && (
          <p className="text-[11px] text-magic-ink/50 text-center py-4 animate-pulse">
            Searching…
          </p>
        )}
        {debounced && !loading && products.length === 0 && (
          <p className="text-[11px] text-magic-ink/50 text-center py-4">
            No products found for &quot;{debounced}&quot;.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {products.map((p) => (
            <li
              key={p.id}
              className="rounded-lg border border-magic-border/60 px-2 py-1.5 hover:border-magic-red/50 hover:bg-magic-soft/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold text-magic-ink truncate">
                    {p.model || "—"}
                  </div>
                  <div className="text-[10px] text-magic-ink/60 truncate">
                    {p.vendor}
                    {p.system ? ` · ${p.system}` : ""}
                  </div>
                  {p.description && (
                    <div className="text-[10px] text-magic-ink/50 line-clamp-2 mt-0.5">
                      {p.description}
                    </div>
                  )}
                  {p.price_si > 0 && (
                    <div className="text-[10px] text-magic-red font-semibold mt-0.5">
                      {p.currency || "JOD"} {Number(p.price_si).toFixed(2)}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleAdd(p)}
                  title={`Add to "${resolvedPage || `${p.vendor} ${p.system}`.trim() || "General"}"`}
                  aria-label="Add product"
                  className="shrink-0 w-6 h-6 rounded-full bg-magic-red text-white flex items-center justify-center text-xs font-bold hover:bg-red-700 active:scale-95 transition-transform"
                >
                  +
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
