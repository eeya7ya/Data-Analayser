"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { SystemEntry } from "@/lib/manifest.generated";
import type { SessionUser } from "@/lib/auth";
import type { ScoredProduct } from "@/lib/search";

// ─── Types ──────────────────────────────────────────────────────────────────

interface CartItem {
  systemId: number;
  vendor: string;
  product: Record<string, unknown>;
  quantity: number;
  unitPrice: number;
  currency: string;
}

interface HitWithSystem extends ScoredProduct {
  system?: SystemEntry;
}

interface QuotationListItem {
  id: number;
  ref: string;
  project_name: string;
  client_name: string | null;
  site_name: string;
  created_at: string;
}

interface StoredQuotationItem {
  no: number;
  brand: string;
  model: string;
  description: string;
  quantity: number;
  unit_price: number;
  delivery: string;
  picture_hint?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getPrice(p: Record<string, unknown>): { si: number; dpp: number } {
  const pr = (p.pricing || {}) as Record<string, unknown>;
  return {
    si: typeof pr.si === "number" ? pr.si : typeof pr.price === "number" ? pr.price : 0,
    dpp: typeof pr.dpp === "number" ? pr.dpp : 0,
  };
}

/**
 * Recursively flattens a product's spec-like fields into a list of
 * [humanized key, value] pairs. Handles nested objects like `specs`, and the
 * product-level shape used by the HDD / NVR / switch / camera databases.
 */
function flattenEntries(
  obj: Record<string, unknown>,
  prefix = "",
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [rawKey, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "" || v === false) continue;
    const key = rawKey.replace(/_/g, " ");
    const label = prefix ? `${prefix} ${key}` : key;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      out.push([label, v.map((x) => String(x)).join(", ")]);
    } else if (typeof v === "object") {
      out.push(...flattenEntries(v as Record<string, unknown>, label));
    } else if (v === true) {
      out.push([label, "✓"]);
    } else {
      out.push([label, String(v)]);
    }
  }
  return out;
}

// Nested container keys whose inner entries should be inlined directly
// (without "specs …" prefixes on every sub-key).
const INLINE_CONTAINERS = new Set(["specs", "spec", "details"]);

/**
 * Builds a detailed, human-readable product description by walking the full
 * product object (including its nested `specs`). This is what powers the
 * "description" column in the catalog table and the quotation description.
 * The raw database never ships a `description` field, but it ships rich nested
 * specs — this helper materializes them into prose.
 */
function buildDescription(p: Record<string, unknown>): string {
  const SKIP = new Set([
    "id",
    "model",
    "brand",
    "category",
    "sub_category",
    "pricing",
  ]);
  const flatEntries: Array<[string, string]> = [];
  let series: string | null = null;
  for (const [k, v] of Object.entries(p)) {
    if (SKIP.has(k)) continue;
    if (k === "series" && typeof v === "string") {
      series = v;
      continue;
    }
    if (
      INLINE_CONTAINERS.has(k) &&
      v &&
      typeof v === "object" &&
      !Array.isArray(v)
    ) {
      // Inline the container directly — no "specs" prefix on each sub-key.
      flatEntries.push(...flattenEntries(v as Record<string, unknown>));
      continue;
    }
    flatEntries.push(...flattenEntries({ [k]: v }));
  }
  const parts: string[] = [];
  if (series) parts.push(series);
  if (flatEntries.length > 0) {
    parts.push(flatEntries.map(([k, v]) => `${k}: ${v}`).join("  •  "));
  }
  return parts.join(" — ") || "—";
}

function sortVal(
  product: Record<string, unknown>,
  key: string,
  unitPrice: number,
): string | number {
  if (key === "si_price") return unitPrice;
  if (key === "dpp_price") return getPrice(product).dpp;
  if (key === "description") return buildDescription(product);
  const v = product[key];
  if (typeof v === "number") return v;
  if (v && typeof v === "object") return buildDescription({ [key]: v });
  return String(v ?? "");
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CatalogBrowser({
  systems,
  user,
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

  // ── Cart state ────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

  // ── Project state ─────────────────────────────────────────────────────────
  // The catalog is project-first: the user selects an existing project
  // (quotation) from the dropdown — any items added via the catalog are
  // merged into that project on save. "" means "Start a new project".
  const [projectList, setProjectList] = useState<QuotationListItem[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [selectedQuotationId, setSelectedQuotationId] = useState<number | "">(
    "",
  );
  const [existingItems, setExistingItems] = useState<StoredQuotationItem[]>([]);
  const [loadingProject, setLoadingProject] = useState(false);

  // ── Quotation header ──────────────────────────────────────────────────────
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [salesEng, setSalesEng] = useState("ENG. Yahya Khaled");
  const [siteName, setSiteName] = useState("");
  const [taxPercent, setTaxPercent] = useState(16);
  const [saving, setSaving] = useState(false);

  // ── Debounce search ───────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // ── Load the user's existing projects (quotations) on mount ──────────────
  useEffect(() => {
    setLoadingProjects(true);
    fetch("/api/quotations")
      .then((r) => r.json())
      .then((data) => setProjectList(data.quotations || []))
      .catch(() => setProjectList([]))
      .finally(() => setLoadingProjects(false));
  }, []);

  // ── When a project is selected, fetch its details & prefill the form ─────
  useEffect(() => {
    if (!selectedQuotationId) {
      setExistingItems([]);
      return;
    }
    setLoadingProject(true);
    fetch(`/api/quotations?id=${selectedQuotationId}`)
      .then((r) => r.json())
      .then((data) => {
        const row = data.quotation as Record<string, unknown> | null;
        if (!row) return;
        setProjectName(String(row.project_name ?? ""));
        setClientName(String(row.client_name ?? ""));
        setClientEmail(String(row.client_email ?? ""));
        setSalesEng(String(row.sales_engineer ?? "ENG. Yahya Khaled"));
        setSiteName(String(row.site_name ?? ""));
        setTaxPercent(Number(row.tax_percent ?? 16));
        const rawItems = Array.isArray(row.items_json)
          ? (row.items_json as StoredQuotationItem[])
          : [];
        setExistingItems(rawItems);
        setCartOpen(true);
      })
      .catch(() => setExistingItems([]))
      .finally(() => setLoadingProject(false));
  }, [selectedQuotationId]);

  function startNewProject() {
    setSelectedQuotationId("");
    setExistingItems([]);
    setProjectName("");
    setClientName("");
    setClientEmail("");
    setSiteName("");
    setTaxPercent(16);
    setCart([]);
  }

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

  // ── Dynamic visible columns ───────────────────────────────────────────────
  const columns = useMemo(() => {
    const CORE = ["model", "category", "sub_category", "brand"];
    // Keys that should never render as their own column — either because
    // they're metadata (id, pricing) or because they're nested objects
    // (specs) that we render through the synthetic `description` column.
    const ALWAYS_SKIP = new Set(["id", "pricing", "series", "specs"]);
    const extra = new Set<string>();
    for (const h of hits.slice(0, 50)) {
      for (const k of Object.keys(h.product)) {
        if (ALWAYS_SKIP.has(k) || CORE.includes(k)) continue;
        const v = h.product[k];
        // Skip any nested object/array fields — they get folded into the
        // description column instead. This is what prevents "[object Object]"
        // from leaking into the table when a DB puts specs under a nested key.
        if (v && typeof v === "object") continue;
        extra.add(k);
      }
    }
    // Put booleans last, put numeric specs near the front
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
    return [...CORE, ...sortedExtra, "description", "si_price", "dpp_price"];
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

  // ── Cart actions ──────────────────────────────────────────────────────────
  const addToCart = useCallback(
    (h: HitWithSystem, qty = 1) => {
      const sys = systems.find((s) => s.id === systemId) || h.system;
      setCart((prev) => {
        const key = `${sys?.id ?? 0}__${String(h.product.model ?? "")}`;
        const idx = prev.findIndex(
          (c) => `${c.systemId}__${String(c.product.model ?? "")}` === key,
        );
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
          return next;
        }
        return [
          ...prev,
          {
            systemId: sys?.id ?? 0,
            vendor: sys?.vendor ?? "",
            product: h.product,
            quantity: qty,
            unitPrice: h.unitPrice,
            currency: h.currency,
          },
        ];
      });
      setCartOpen(true);
    },
    [systemId, systems],
  );

  function removeFromCart(idx: number) {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateCartQty(idx: number, qty: number) {
    if (qty <= 0) {
      removeFromCart(idx);
      return;
    }
    setCart((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], quantity: qty };
      return next;
    });
  }

  const existingSubtotal = existingItems.reduce(
    (acc, it) => acc + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
    0,
  );
  const newSubtotal = cart.reduce(
    (acc, it) => acc + it.quantity * it.unitPrice,
    0,
  );
  const subtotal = existingSubtotal + newSubtotal;
  const tax = (subtotal * taxPercent) / 100;
  const total = subtotal + tax;

  function removeExistingItem(i: number) {
    setExistingItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  // ── Save quotation ────────────────────────────────────────────────────────
  async function saveQuotation() {
    if (cart.length === 0 && existingItems.length === 0) return;
    if (!selectedQuotationId && cart.length === 0) return;
    setSaving(true);
    try {
      // Build all items: preserved existing ones first, then new cart rows.
      const newItems: StoredQuotationItem[] = cart.map((it) => ({
        no: 0, // renumbered below
        brand: it.vendor,
        model: String(it.product.model ?? ""),
        description: buildDescription(it.product),
        quantity: it.quantity,
        unit_price: it.unitPrice,
        delivery: "Available",
        picture_hint: String(
          (it.product.specs as Record<string, unknown> | undefined)
            ?.form_factor ??
            it.product.form_factor ??
            it.product.category ??
            "",
        ),
      }));
      const combined: StoredQuotationItem[] = [
        ...existingItems,
        ...newItems,
      ].map((it, i) => ({ ...it, no: i + 1 }));

      const totals = { subtotal, tax, total };
      let data: { quotation?: { id: number }; error?: string };

      if (selectedQuotationId) {
        // Editing an existing project — PATCH so header updates are kept.
        const res = await fetch("/api/quotations", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: selectedQuotationId,
            project_name: projectName || undefined,
            client_name: clientName,
            client_email: clientEmail,
            sales_engineer: salesEng,
            site_name: siteName,
            tax_percent: taxPercent,
            items: combined,
            totals,
          }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "update failed");
      } else {
        const res = await fetch("/api/quotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_name: projectName || "Manual Quotation",
            client_name: clientName,
            client_email: clientEmail,
            sales_engineer: salesEng,
            site_name: siteName,
            prepared_by: user.username,
            tax_percent: taxPercent,
            items: combined,
            totals,
          }),
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "save failed");
      }
      if (data.quotation?.id) {
        router.push(`/quotation?id=${data.quotation.id}`);
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

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

  const selectedProject = projectList.find(
    (p) => p.id === selectedQuotationId,
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* ── Project bar — this is the "base". The catalog is always scoped
          to a project (new or existing). AI design is an additive tool that
          feeds the same project. ── */}
      <div className="rounded-2xl border border-magic-border bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-64">
            <label className="block text-[10px] font-semibold uppercase text-magic-ink/60 mb-1">
              Active project
            </label>
            <select
              value={selectedQuotationId}
              onChange={(e) =>
                setSelectedQuotationId(
                  e.target.value ? Number(e.target.value) : "",
                )
              }
              className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
            >
              <option value="">
                {loadingProjects
                  ? "Loading projects…"
                  : "— Start a new project —"}
              </option>
              {projectList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.ref} · {p.project_name}
                  {p.client_name ? ` · ${p.client_name}` : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-magic-ink/50">
              {loadingProject
                ? "Loading project details…"
                : selectedProject
                  ? `Editing ${selectedProject.ref} — catalog picks will be merged into this project.`
                  : "Pick an existing project to add catalog items to it, or keep this blank to start a new one."}
            </p>
          </div>
          {selectedQuotationId && (
            <button
              type="button"
              onClick={startNewProject}
              className="rounded-lg border border-magic-border px-3 py-2 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft"
            >
              Start new project
            </button>
          )}
          <a
            href={
              selectedQuotationId
                ? `/designer?project=${selectedQuotationId}`
                : "/designer"
            }
            className="rounded-lg border border-magic-red text-magic-red px-3 py-2 text-xs font-semibold hover:bg-magic-red/5"
            title={
              selectedQuotationId
                ? "Open the AI designer and merge its output into this project"
                : "Open the AI designer"
            }
          >
            AI-design a BoQ
          </a>
        </div>
      </div>

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

        <div className="pt-5">
          <button
            onClick={() => setCartOpen((o) => !o)}
            className="relative rounded-lg border border-magic-red text-magic-red px-4 py-2 text-sm font-semibold hover:bg-magic-red/5"
          >
            Cart
            {cart.length > 0 && (
              <span className="absolute -top-2 -right-2 bg-magic-red text-white text-[10px] rounded-full w-5 h-5 flex items-center justify-center font-bold">
                {cart.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Main content area ── */}
      <div className="flex gap-4">
        {/* Product table */}
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
              </div>
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
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
                              onClick={() => addToCart(h)}
                              title="Add to cart"
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
                            } else if (col === "description") {
                              val = buildDescription(h.product);
                            } else {
                              val = h.product[col];
                            }
                            // Defensively flatten any object that slips into a
                            // regular column — this prevents "[object Object]"
                            // from ever reaching the DOM.
                            if (val && typeof val === "object") {
                              val = buildDescription(
                                val as Record<string, unknown>,
                              );
                            }
                            const display =
                              val === null || val === undefined || val === ""
                                ? "—"
                                : val === true
                                  ? "✓"
                                  : val === false
                                    ? ""
                                    : String(val);
                            const isDescription = col === "description";
                            return (
                              <td
                                key={col}
                                className={`px-3 py-1.5 ${
                                  isDescription
                                    ? "whitespace-normal min-w-[22rem] max-w-[30rem] text-[11px] leading-snug"
                                    : "whitespace-nowrap"
                                } ${
                                  col === "model"
                                    ? "font-semibold text-magic-ink"
                                    : val === true
                                      ? "text-green-600 font-medium"
                                      : col === "si_price" ||
                                          col === "dpp_price"
                                        ? "text-magic-red font-semibold"
                                        : "text-magic-ink/70"
                                }`}
                                title={isDescription ? display : undefined}
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

        {/* Cart panel */}
        {cartOpen && (
          <div className="w-80 shrink-0 flex flex-col gap-3">
            {/* Existing project items (loaded from the selected quotation) */}
            {selectedQuotationId && (
              <div className="rounded-2xl border border-magic-border bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-magic-border">
                  <p className="text-xs font-semibold text-magic-ink">
                    Already in project ({existingItems.length})
                  </p>
                  <p className="text-[10px] text-magic-ink/50 mt-0.5">
                    Catalog additions below will be merged into this project.
                  </p>
                </div>
                {existingItems.length === 0 ? (
                  <p className="p-3 text-[11px] text-magic-ink/40 text-center">
                    This project has no items yet.
                  </p>
                ) : (
                  <div className="divide-y divide-magic-border/50 max-h-48 overflow-y-auto">
                    {existingItems.map((it, i) => (
                      <div
                        key={i}
                        className="px-3 py-2 flex items-center gap-2"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-magic-ink truncate">
                            {it.model}
                          </p>
                          <p className="text-[10px] text-magic-ink/50 truncate">
                            {it.brand} · qty {it.quantity} · $
                            {Number(it.unit_price || 0).toFixed(2)}
                          </p>
                        </div>
                        <button
                          onClick={() => removeExistingItem(i)}
                          className="text-magic-ink/30 hover:text-magic-red text-sm leading-none"
                          title="Remove from project"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* New cart items — items added from the catalog in this session */}
            <div className="rounded-2xl border border-magic-border bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-magic-border flex items-center justify-between">
                <span className="text-xs font-semibold text-magic-ink">
                  {selectedQuotationId
                    ? `New additions (${cart.length})`
                    : `Selected items (${cart.length})`}
                </span>
                {cart.length > 0 && (
                  <button
                    onClick={() => setCart([])}
                    className="text-[10px] text-magic-ink/40 hover:text-magic-red"
                  >
                    Clear all
                  </button>
                )}
              </div>
              {cart.length === 0 ? (
                <p className="p-4 text-xs text-magic-ink/40 text-center">
                  Click + on any product row to add.
                </p>
              ) : (
                <div className="divide-y divide-magic-border/50 max-h-80 overflow-y-auto">
                  {cart.map((it, i) => (
                    <div key={i} className="px-3 py-2 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-magic-ink truncate">
                          {String(it.product.model ?? "")}
                        </p>
                        <p className="text-[10px] text-magic-ink/50">
                          {it.vendor}{" "}
                          {it.unitPrice > 0
                            ? `· ${it.currency} ${it.unitPrice}`
                            : ""}
                        </p>
                      </div>
                      <input
                        type="number"
                        min={1}
                        value={it.quantity}
                        onChange={(e) =>
                          updateCartQty(i, Number(e.target.value))
                        }
                        className="w-14 rounded border border-magic-border text-center text-xs py-0.5"
                      />
                      <button
                        onClick={() => removeFromCart(i)}
                        className="text-magic-ink/30 hover:text-magic-red text-sm leading-none"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {(cart.length > 0 || existingItems.length > 0) && (
                <div className="border-t border-magic-border px-3 py-2 text-xs space-y-0.5">
                  <div className="flex justify-between text-magic-ink/60">
                    <span>Subtotal</span>
                    <span>${subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-magic-ink/60">
                    <span>Tax ({taxPercent}%)</span>
                    <span>${tax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-magic-ink border-t border-magic-border pt-1 mt-1">
                    <span>Total</span>
                    <span>${total.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Quotation header */}
            {(cart.length > 0 || existingItems.length > 0) && (
              <div className="rounded-2xl border border-magic-border bg-white p-4 space-y-2">
                <p className="text-xs font-semibold text-magic-ink mb-2">
                  {selectedQuotationId
                    ? "Project details"
                    : "Quotation details"}
                </p>
                {[
                  {
                    label: "Project name",
                    val: projectName,
                    set: setProjectName,
                  },
                  { label: "Site", val: siteName, set: setSiteName },
                  { label: "Client", val: clientName, set: setClientName },
                  {
                    label: "Client email",
                    val: clientEmail,
                    set: setClientEmail,
                  },
                  {
                    label: "Sales engineer",
                    val: salesEng,
                    set: setSalesEng,
                  },
                ].map(({ label, val, set }) => (
                  <div key={label}>
                    <label className="block text-[10px] font-semibold uppercase text-magic-ink/50">
                      {label}
                    </label>
                    <input
                      value={val}
                      onChange={(e) => set(e.target.value)}
                      className="mt-0.5 w-full rounded border border-magic-border px-2 py-1 text-xs"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-magic-ink/50">
                    Tax %
                  </label>
                  <input
                    type="number"
                    value={taxPercent}
                    onChange={(e) => setTaxPercent(Number(e.target.value))}
                    className="mt-0.5 w-full rounded border border-magic-border px-2 py-1 text-xs"
                  />
                </div>
                <button
                  onClick={saveQuotation}
                  disabled={
                    saving || (!selectedQuotationId && cart.length === 0)
                  }
                  className="w-full mt-2 rounded-md bg-magic-red text-white py-2 text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
                >
                  {saving
                    ? "Saving…"
                    : selectedQuotationId
                      ? cart.length > 0
                        ? `Save ${cart.length} item(s) to project & open`
                        : "Save project changes & open"
                      : "Save & open printable quotation"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
