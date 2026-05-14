"use client";

import { useEffect, useState } from "react";

/**
 * Modal-style affordance on /projects/[id] for filing a storage
 * request against the current project. Posts to the existing
 * /api/storage/requests endpoint (Phase 6) — no new schema.
 *
 * Renders nothing for users without projects.* / storage.* / admin
 * (the server endpoint would 403 anyway, but the button being
 * present-but-disabled would be confusing).
 */

interface ProductLite {
  id: number;
  vendor: string;
  model: string;
}

interface LocationLite {
  id: number;
  name: string;
}

export default function RequestStockButton({
  projectId,
}: {
  projectId: number;
}) {
  const [open, setOpen] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then(
        (data: {
          user?: { role?: string } | null;
          module_roles?: Array<{ module: string }>;
        }) => {
          if (cancelled) return;
          const isAdmin = data.user?.role === "admin";
          const has = (m: string) =>
            (data.module_roles ?? []).some((r) => r.module === m);
          setAllowed(isAdmin || has("projects") || has("storage"));
        },
      )
      .catch(() => {
        if (!cancelled) setAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!allowed) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-magic-red text-magic-red px-3 py-1.5 text-xs font-semibold hover:bg-magic-red hover:text-white transition-colors"
      >
        Request stock
      </button>
      {open && (
        <RequestStockModal
          projectId={projectId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function RequestStockModal({
  projectId,
  onClose,
}: {
  projectId: number;
  onClose: () => void;
}) {
  const [locations, setLocations] = useState<LocationLite[]>([]);
  const [results, setResults] = useState<ProductLite[]>([]);
  const [query, setQuery] = useState("");
  const [productId, setProductId] = useState<number | null>(null);
  const [productLabel, setProductLabel] = useState("");
  const [quantity, setQuantity] = useState<string>("1");
  const [locationId, setLocationId] = useState<number | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    void fetch("/api/storage/locations", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { locations?: LocationLite[] }) =>
        setLocations(data.locations ?? []),
      )
      .catch(() => {
        // soft-fail
      });
  }, []);

  // Search the catalogue. We use /api/database/search if present;
  // fallback to /api/catalogue/products. Debounced via the timer.
  useEffect(() => {
    if (!query.trim() || productId !== null) {
      setResults([]);
      return;
    }
    const ctl = new AbortController();
    const handle = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query.trim(), limit: "20" });
        const res = await fetch(`/api/catalogue/products?${params}`, {
          signal: ctl.signal,
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          products?: Array<{ id: number; vendor: string; model: string }>;
        };
        if (Array.isArray(data.products)) {
          setResults(
            data.products.map((p) => ({
              id: p.id,
              vendor: p.vendor,
              model: p.model,
            })),
          );
        }
      } catch {
        // ignore abort + network
      }
    }, 220);
    return () => {
      window.clearTimeout(handle);
      ctl.abort();
    };
  }, [query, productId]);

  async function submit() {
    if (productId === null) {
      setError("Pick a product first.");
      return;
    }
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError("Quantity must be a positive integer.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/storage/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          product_id: productId,
          location_id: locationId === "" ? null : locationId,
          quantity: qty,
          reason: reason.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setSuccess(true);
      window.setTimeout(onClose, 900);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-magic-ink/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-magic-ink">
            Request stock for this project
          </h3>
          <button
            onClick={onClose}
            className="text-magic-ink/50 hover:text-magic-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {success ? (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            Request filed. Storage manager will see it in their inbox.
          </p>
        ) : (
          <>
            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-magic-ink/70 mb-1">
                  Product
                </label>
                {productId === null ? (
                  <>
                    <input
                      type="search"
                      placeholder="Search vendor or model…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="w-full rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
                    />
                    {results.length > 0 && (
                      <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-magic-border bg-white">
                        {results.map((p) => (
                          <li key={p.id}>
                            <button
                              onClick={() => {
                                setProductId(p.id);
                                setProductLabel(`${p.vendor} · ${p.model}`);
                                setResults([]);
                                setQuery("");
                              }}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-magic-soft"
                            >
                              <span className="text-magic-ink/70">{p.vendor}</span>{" "}
                              <span className="font-mono">{p.model}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-between gap-2 rounded border border-magic-border bg-magic-soft/40 px-2 py-1.5">
                    <span>{productLabel}</span>
                    <button
                      onClick={() => {
                        setProductId(null);
                        setProductLabel("");
                      }}
                      className="text-xs text-magic-ink/60 hover:text-magic-red"
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-magic-ink/70 mb-1">
                    Quantity
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="w-full rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-magic-ink/70 mb-1">
                    Preferred location
                  </label>
                  <select
                    value={locationId}
                    onChange={(e) =>
                      setLocationId(
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    className="w-full rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
                  >
                    <option value="">— any —</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-magic-ink/70 mb-1">
                  Reason (optional)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="w-full rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
                  placeholder="When and why you need this."
                />
              </div>
            </div>

            {error && (
              <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-semibold rounded border border-magic-border text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void submit()}
                disabled={busy || productId === null}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
              >
                {busy ? "Filing…" : "File request"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
