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
    const CORE = ["model", "category", "sub_category"];
    const ALWAYS_SKIP = new Set(["id", "pricing", "series"]);
    const extra = new Set<string>();
    for (const h of hits.slice(0, 50)) {
      for (const k of Object.keys(h.product)) {
        if (!ALWAYS_SKIP.has(k) && !CORE.includes(k)) extra.add(k);
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

  const subtotal = cart.reduce((acc, it) => acc + it.quantity * it.unitPrice, 0);
  const tax = (subtotal * taxPercent) / 100;
  const total = subtotal + tax;

  // ── Save quotation ────────────────────────────────────────────────────────
  async function saveQuotation() {
    if (cart.length === 0) return;
    setSaving(true);
    try {
      const items = cart.map((it, i) => ({
        no: i + 1,
        brand: it.vendor,
        model: String(it.product.model ?? ""),
        description: flatSpecs(it.product),
        quantity: it.quantity,
        unit_price: it.unitPrice,
        delivery: "Available",
        picture_hint: String(
          it.product.form_factor ?? it.product.category ?? "",
        ),
      }));
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
          items,
          totals: { subtotal, tax, total },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "save failed");
      router.push(`/quotation?id=${data.quotation.id}`);
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

        {/* Cart panel */}
        {cartOpen && (
          <div className="w-80 shrink-0 flex flex-col gap-3">
            {/* Cart items */}
            <div className="rounded-2xl border border-magic-border bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-magic-border flex items-center justify-between">
                <span className="text-xs font-semibold text-magic-ink">
                  Selected items ({cart.length})
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
              {cart.length > 0 && (
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
            {cart.length > 0 && (
              <div className="rounded-2xl border border-magic-border bg-white p-4 space-y-2">
                <p className="text-xs font-semibold text-magic-ink mb-2">
                  Quotation details
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
                  disabled={saving}
                  className="w-full mt-2 rounded-md bg-magic-red text-white py-2 text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save & open printable quotation"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
