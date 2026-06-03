"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { SessionUser } from "@/lib/auth";
import { compressDataUrl } from "@/components/QuotationPreview";

// Belt-and-braces upload cap. The compressDataUrl pass usually lands well
// under this for any normal product photo (canvas re-encode at 800px /
// JPEG q=0.7 ≈ 50–120 KB). Keeping the post-compress ceiling at ~200 KB
// matches the user's guidance ("just clear enough to see the item, no
// more"); the API enforces the same bound server-side.
const PICTURE_MAX_BYTES = 200_000;

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
  picture_url?: string | null;
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
  { key: "system", label: "System", width: "7%" },
  { key: "category", label: "Category", width: "7%" },
  { key: "sub_category", label: "Sub Category", width: "8%" },
  { key: "fast_view", label: "Fast View", width: "9%", wrap: true },
  // Picture sits immediately after Fast View and before Model — the
  // user-requested position. A square 64px thumbnail fits comfortably in
  // an 8% column and clicks through to a full-size preview.
  { key: "picture_url", label: "Picture", width: "8%" },
  { key: "model", label: "Model", width: "11%", wrap: true },
  { key: "description", label: "Description", width: "20%", wrap: true },
  { key: "currency", label: "Currency", width: "5%" },
  { key: "price_si", label: "Price SI", width: "7%" },
  { key: "specifications", label: "Specifications", width: "12%", wrap: true },
];

// ─── Main component ─────────────────────────────────────────────────────────

export default function CatalogBrowser({
  user,
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
  // This page is the Catalogue Modifier, gated to storage + admin, so every
  // user who reaches it may edit the catalogue. The API enforces the same
  // (admin or storage) on PATCH / DELETE / upload. `user` is still accepted so
  // the server page can pass it.
  void user;
  const canEdit = true;
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

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

      </div>

      <p className="text-[11px] text-magic-ink/60 -mt-1">
        Pick a vendor / system to browse its full catalogue, or search across
        <b> every vendor</b>. Changes you make here update the live catalogue
        that presales pick from in the quotation designer.
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

        {editingProduct && (
          <EditProductModal
            product={editingProduct}
            onCancel={() => setEditingProduct(null)}
            onSaved={(updated) => {
              setProducts((prev) =>
                prev.map((row) => (row.id === updated.id ? updated : row)),
              );
              setEditingProduct(null);
            }}
            onDeleted={(id) => {
              setProducts((prev) => prev.filter((row) => row.id !== id));
              setTotal((t) => Math.max(0, t - 1));
              setEditingProduct(null);
            }}
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
                        <div className="flex items-center gap-1">
                          {canEdit && (
                            <button
                              onClick={() => setEditingProduct(p)}
                              title="Edit product values"
                              aria-label="Edit product"
                              className="w-7 h-7 rounded-full border border-magic-border bg-white text-magic-ink/60 flex items-center justify-center hover:bg-magic-soft hover:text-magic-red hover:border-magic-red/40 focus:outline-none focus:ring-2 focus:ring-magic-red/30 transition-colors"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                                className="w-3.5 h-3.5"
                                aria-hidden="true"
                              >
                                <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828zM2 17a1 1 0 011-1h14a1 1 0 110 2H3a1 1 0 01-1-1z" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                      {DISPLAY_COLUMNS.map((col) => {
                        const val = p[col.key];
                        // Picture column renders an <img> instead of text;
                        // bail out of the text/sort path early. The cell
                        // shows a small thumbnail when set, an em-dash
                        // placeholder otherwise.
                        if (col.key === "picture_url") {
                          const url = p.picture_url;
                          return (
                            <td
                              key={col.key}
                              className="px-2 py-1.5 align-middle text-center"
                            >
                              {url ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                  src={url}
                                  alt={`${p.model} thumbnail`}
                                  className="inline-block w-14 h-14 object-cover rounded border border-magic-border"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(url, "_blank", "noopener");
                                  }}
                                  title="Click to open the full image"
                                  style={{ cursor: "zoom-in" }}
                                />
                              ) : (
                                <span className="text-magic-ink/30">—</span>
                              )}
                            </td>
                          );
                        }
                        let display: string;
                        if (col.key === "price_si") {
                          const raw = Number(val);
                          display =
                            raw > 0
                              ? `${p.currency} ${raw.toFixed(2)}`
                              : "";
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

// ─── Admin: edit a single catalogue row ──────────────────────────────────────

const EDIT_FIELDS: Array<{
  key: keyof Omit<Product, "id">;
  label: string;
  type: "text" | "textarea" | "number" | "image";
}> = [
  { key: "vendor", label: "Vendor", type: "text" },
  { key: "system", label: "System", type: "text" },
  { key: "category", label: "Category", type: "text" },
  { key: "sub_category", label: "Sub Category", type: "text" },
  { key: "fast_view", label: "Fast View", type: "text" },
  { key: "picture_url", label: "Picture", type: "image" },
  { key: "model", label: "Model", type: "text" },
  { key: "currency", label: "Currency", type: "text" },
  { key: "price_si", label: "Price SI", type: "number" },
  { key: "description", label: "Description", type: "textarea" },
  { key: "specifications", label: "Specifications", type: "textarea" },
];

/**
 * Inline picture upload widget used inside the EditProductModal.
 * Reuses the Designer's `compressDataUrl` so any uploaded image is
 * downscaled to ≤800px wide and re-encoded as JPEG q=0.7 before being
 * sent. Anything still larger than PICTURE_MAX_BYTES after that pass is
 * rejected with a readable error rather than silently truncated.
 *
 * Value semantics:
 *   - null / "" → no picture set, render a placeholder + "Upload" button
 *   - data URL  → render the thumbnail + "Change" / "Remove" buttons
 *
 * Errors bubble up through `onError` so the parent modal can show them
 * in its existing red banner instead of every uploader spawning its own.
 */
function PictureUploader({
  value,
  onChange,
  onError,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  onError: (msg: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = useCallback(
    async (file: File) => {
      onError(null);
      if (!file.type.startsWith("image/")) {
        onError("Please choose an image file (PNG, JPEG, WebP).");
        return;
      }
      setBusy(true);
      try {
        const reader = new FileReader();
        const original = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const compressed = await compressDataUrl(original);
        if (compressed.length > PICTURE_MAX_BYTES) {
          // Even after compression the image is too big — that usually
          // means the source was a very large or noisy photo. Telling the
          // user explicitly is friendlier than the API's silent drop.
          onError(
            `Picture is still too large after compression (${Math.round(compressed.length / 1024)} KB). Please choose a smaller image.`,
          );
          return;
        }
        onChange(compressed);
      } catch (err) {
        onError((err as Error).message || "Failed to read the image.");
      } finally {
        setBusy(false);
      }
    },
    [onChange, onError],
  );

  return (
    <div className="flex items-center gap-3">
      <div className="w-20 h-20 rounded-lg border border-magic-border bg-magic-soft/40 flex items-center justify-center overflow-hidden flex-shrink-0">
        {value ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={value}
            alt="Product preview"
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-[10px] text-magic-ink/40 text-center px-1">
            No picture
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            // Reset so re-selecting the same filename still fires onChange.
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded-md border border-magic-border bg-white px-3 py-1.5 text-xs font-semibold text-magic-ink hover:border-magic-red hover:text-magic-red disabled:opacity-50"
        >
          {busy ? "Compressing…" : value ? "Change picture" : "Upload picture"}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={busy}
            className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Remove
          </button>
        )}
        <span className="text-[10px] text-magic-ink/50">
          Auto-compressed to ≤200 KB.
        </span>
      </div>
    </div>
  );
}

function EditProductModal({
  product,
  onCancel,
  onSaved,
  onDeleted,
}: {
  product: Product;
  onCancel: () => void;
  onSaved: (updated: Product) => void;
  onDeleted: (id: number) => void;
}) {
  const [draft, setDraft] = useState<Product>(product);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving && !deleting) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, saving, deleting]);

  const dirty = useMemo(() => {
    return EDIT_FIELDS.some((f) => {
      const a = product[f.key];
      const b = draft[f.key];
      if (f.type === "number") return Number(a) !== Number(b);
      return String(a ?? "") !== String(b ?? "");
    });
  }, [product, draft]);

  const update = useCallback(
    (key: keyof Omit<Product, "id">, value: string | null) => {
      setDraft((prev) => {
        if (key === "price_si") {
          const n = Number(value);
          return { ...prev, price_si: Number.isFinite(n) ? n : 0 };
        }
        if (key === "picture_url") {
          // Empty / null clears the column; non-empty strings (data URLs)
          // pass straight through and are validated server-side.
          return { ...prev, picture_url: value ? value : null };
        }
        return { ...prev, [key]: value ?? "" };
      });
    },
    [],
  );

  const save = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const body: Partial<Product> = {};
      for (const f of EDIT_FIELDS) {
        const prev = product[f.key];
        const next = draft[f.key];
        if (f.type === "number") {
          if (Number(prev) !== Number(next)) {
            (body as Record<string, unknown>)[f.key] = Number(next);
          }
        } else if (f.type === "image") {
          // Image fields send literal null when cleared (so the API
          // knows to wipe the column) and the raw data URL otherwise —
          // never .trim()'d, since trim could in theory damage future
          // formats and the data URL has no leading/trailing whitespace.
          const prevStr = prev == null ? "" : String(prev);
          const nextStr = next == null ? "" : String(next);
          if (prevStr !== nextStr) {
            (body as Record<string, unknown>)[f.key] = nextStr === "" ? null : nextStr;
          }
        } else if (String(prev ?? "") !== String(next ?? "")) {
          (body as Record<string, unknown>)[f.key] = String(next ?? "").trim();
        }
      }
      const res = await fetch(`/api/catalogue/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        product?: Product;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      if (data.product) onSaved(data.product);
    } catch (err) {
      setError((err as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, draft, product, onSaved]);

  const remove = useCallback(async () => {
    if (deleting) return;
    if (
      !confirm(
        `Delete "${product.model}" from the catalogue? This cannot be undone.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/catalogue/products/${product.id}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      onDeleted(product.id);
    } catch (err) {
      setError((err as Error).message || "Delete failed");
    } finally {
      setDeleting(false);
    }
  }, [deleting, product, onDeleted]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => {
        if (!saving && !deleting) onCancel();
      }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-magic-ink">Edit product</h2>
            <p className="mt-1 text-xs text-magic-ink/60">
              Updating <b>{product.model}</b>. Changes are written straight to
              the catalogue database.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving || deleting}
            className="rounded-full w-8 h-8 flex items-center justify-center text-magic-ink/40 hover:bg-magic-soft hover:text-magic-ink disabled:opacity-50"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {EDIT_FIELDS.map((f) => {
            const value = draft[f.key];
            const commonClass =
              "w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:outline-none focus:border-magic-red focus:ring-2 focus:ring-magic-red/20";
            // The image variant renders its own buttons (Change / Remove)
            // so a wrapping <label> would forward stray clicks to the
            // hidden file input. Use a plain <div> for image fields and
            // keep <label> for everything that is genuinely a single
            // labelable input.
            const Wrapper = f.type === "image" ? "div" : "label";
            return (
              <Wrapper
                key={f.key as string}
                className={`flex flex-col gap-1 ${
                  f.type === "textarea" ? "md:col-span-2" : ""
                }`}
              >
                <span className="text-[10px] font-semibold uppercase text-magic-ink/60">
                  {f.label}
                </span>
                {f.type === "textarea" ? (
                  <textarea
                    value={String(value ?? "")}
                    rows={3}
                    onChange={(e) => update(f.key, e.target.value)}
                    className={commonClass}
                  />
                ) : f.type === "number" ? (
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={Number(value) || 0}
                    onChange={(e) => update(f.key, e.target.value)}
                    className={commonClass}
                  />
                ) : f.type === "image" ? (
                  <PictureUploader
                    value={value == null ? null : String(value)}
                    onChange={(next) => update(f.key, next)}
                    onError={(msg) => setError(msg)}
                  />
                ) : (
                  <input
                    type="text"
                    value={String(value ?? "")}
                    onChange={(e) => update(f.key, e.target.value)}
                    className={commonClass}
                  />
                )}
              </Wrapper>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={remove}
            disabled={saving || deleting}
            className="rounded-lg border border-red-200 text-red-700 px-3 py-2 text-xs font-semibold hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete product"}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving || deleting}
              className="rounded-lg px-4 py-2 text-sm text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving || deleting}
              className="rounded-lg bg-magic-red px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
