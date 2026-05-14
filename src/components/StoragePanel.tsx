"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * StoragePanel — three tabs (Locations / Stock / Requests) with role-
 * aware affordances. Read endpoints work for any storage.* /
 * projects.* user; write actions (create location, set stock, change
 * request status) are gated server-side and shown here only when
 * `canManage` is true. Stock is a paginated table per location;
 * requests filter by status.
 */

interface Location {
  id: number;
  name: string;
  address: string | null;
  created_at: string;
  deleted_at: string | null;
}

interface StockItem {
  product_id: number;
  product_model: string;
  product_vendor: string;
  location_id: number;
  location_name: string;
  on_hand: number;
  reserved: number;
  updated_at: string;
}

interface StorageRequest {
  id: number;
  project_id: number | null;
  project_name: string | null;
  product_id: number | null;
  product_model: string | null;
  product_vendor: string | null;
  location_id: number | null;
  location_name: string | null;
  quantity: number;
  requested_by: number | null;
  requested_by_username: string | null;
  status: "pending" | "approved" | "denied" | "fulfilled";
  handled_by: number | null;
  handled_by_username: string | null;
  handled_at: string | null;
  reason: string | null;
  created_at: string;
}

type Tab = "locations" | "stock" | "requests";

export default function StoragePanel({
  canManage,
  hasProjectsModule,
}: {
  canManage: boolean;
  hasProjectsModule: boolean;
}) {
  const [tab, setTab] = useState<Tab>("requests");
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-magic-border mb-4">
        <TabButton active={tab === "requests"} onClick={() => setTab("requests")}>
          Requests
        </TabButton>
        <TabButton active={tab === "stock"} onClick={() => setTab("stock")}>
          Stock
        </TabButton>
        <TabButton
          active={tab === "locations"}
          onClick={() => setTab("locations")}
        >
          Locations
        </TabButton>
      </div>

      {tab === "requests" && (
        <RequestsTab
          canManage={canManage}
          hasProjectsModule={hasProjectsModule}
          onError={setError}
        />
      )}
      {tab === "stock" && (
        <StockTab canManage={canManage} onError={setError} />
      )}
      {tab === "locations" && (
        <LocationsTab canManage={canManage} onError={setError} />
      )}

      {error && (
        <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}

function LocationsTab({
  canManage,
  onError,
}: {
  canManage: boolean;
  onError: (msg: string) => void;
}) {
  const [items, setItems] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/storage/locations", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { locations: Location[] };
      setItems(data.locations);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/storage/locations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), address: address.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setName("");
      setAddress("");
      await refresh();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: number, archived: boolean) {
    if (
      archived &&
      !window.confirm(
        "Archive this location? Stock rows and history stay queryable; nothing is deleted. Unarchive any time.",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch("/api/storage/locations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, archived }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="rounded-xl border border-dashed border-magic-border bg-white p-4">
          <h3 className="font-semibold text-magic-ink mb-2">
            Add a warehouse location
          </h3>
          <div className="grid gap-2 md:grid-cols-3">
            <input
              type="text"
              placeholder="Name (e.g. Main Warehouse)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              className="rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
            />
            <input
              type="text"
              placeholder="Address (optional)"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={busy}
              className="rounded border border-magic-border bg-white px-2 py-1.5 text-sm md:col-span-2"
            />
          </div>
          <div className="mt-2 flex justify-end">
            <button
              onClick={() => void create()}
              disabled={busy || !name.trim()}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
            >
              Add location
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-magic-ink/60">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-magic-ink/50 italic">
          No storage locations yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((l) => (
            <li
              key={l.id}
              className={`rounded-xl border bg-white p-3 flex items-center justify-between gap-3 ${
                l.deleted_at
                  ? "border-magic-border/40 opacity-60"
                  : "border-magic-border"
              }`}
            >
              <div>
                <div className="font-semibold text-magic-ink">{l.name}</div>
                {l.address && (
                  <div className="text-xs text-magic-ink/60">{l.address}</div>
                )}
                {l.deleted_at && (
                  <div className="text-xs text-amber-700 mt-0.5">
                    Archived {new Date(l.deleted_at).toLocaleDateString()}
                  </div>
                )}
              </div>
              {canManage && (
                <button
                  onClick={() => void archive(l.id, !l.deleted_at)}
                  disabled={busy}
                  className="px-2 py-1 text-xs font-medium rounded border border-magic-border text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50 transition-colors"
                >
                  {l.deleted_at ? "Unarchive" : "Archive"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StockTab({
  canManage,
  onError,
}: {
  canManage: boolean;
  onError: (msg: string) => void;
}) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState<number | "">("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (locationId !== "") params.set("location_id", String(locationId));
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/storage/stock?${params}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { stock: StockItem[] };
      setItems(data.stock);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [locationId, query, onError]);

  useEffect(() => {
    void fetch("/api/storage/locations", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { locations?: Location[] }) =>
        setLocations(data.locations ?? []),
      )
      .catch(() => {
        // soft-fail
      });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function setOnHand(
    productId: number,
    locId: number,
    onHand: number,
  ) {
    try {
      const res = await fetch("/api/storage/stock", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product_id: productId,
          location_id: locId,
          on_hand: onHand,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={locationId}
          onChange={(e) =>
            setLocationId(e.target.value === "" ? "" : Number(e.target.value))
          }
          className="rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
        >
          <option value="">All locations</option>
          {locations
            .filter((l) => !l.deleted_at)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </select>
        <input
          type="search"
          placeholder="Search product / vendor…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-0 rounded border border-magic-border bg-white px-3 py-1.5 text-sm"
        />
      </div>

      {loading ? (
        <p className="text-sm text-magic-ink/60">Loading stock…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-magic-ink/50 italic">
          No stock rows match this filter.
        </p>
      ) : (
        <div className="rounded-xl border border-magic-border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-magic-soft/40 text-xs uppercase text-magic-ink/60">
              <tr>
                <th className="text-left px-3 py-2">Location</th>
                <th className="text-left px-3 py-2">Vendor</th>
                <th className="text-left px-3 py-2">Model</th>
                <th className="text-right px-3 py-2">On hand</th>
                <th className="text-right px-3 py-2">Reserved</th>
                {canManage && <th className="text-right px-3 py-2">Set</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-magic-border/40">
              {items.map((it) => (
                <StockRow
                  key={`${it.product_id}.${it.location_id}`}
                  item={it}
                  canManage={canManage}
                  onSetOnHand={(n) => setOnHand(it.product_id, it.location_id, n)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StockRow({
  item,
  canManage,
  onSetOnHand,
}: {
  item: StockItem;
  canManage: boolean;
  onSetOnHand: (n: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string>(String(item.on_hand));
  useEffect(() => setDraft(String(item.on_hand)), [item.on_hand]);
  return (
    <tr>
      <td className="px-3 py-1.5">{item.location_name}</td>
      <td className="px-3 py-1.5">{item.product_vendor}</td>
      <td className="px-3 py-1.5 font-mono text-xs">{item.product_model}</td>
      <td className="px-3 py-1.5 text-right">{item.on_hand}</td>
      <td className="px-3 py-1.5 text-right text-magic-ink/60">
        {item.reserved}
      </td>
      {canManage && (
        <td className="px-3 py-1.5 text-right">
          <div className="inline-flex items-center gap-1">
            <input
              type="number"
              min={0}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-20 rounded border border-magic-border bg-white px-2 py-1 text-xs text-right"
            />
            <button
              onClick={() => {
                const n = Number(draft);
                if (Number.isInteger(n) && n >= 0) void onSetOnHand(n);
              }}
              className="px-2 py-1 text-xs font-semibold rounded bg-magic-red text-white hover:bg-magic-red/90 transition-colors"
            >
              Save
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

function RequestsTab({
  canManage,
  hasProjectsModule,
  onError,
}: {
  canManage: boolean;
  hasProjectsModule: boolean;
  onError: (msg: string) => void;
}) {
  const [items, setItems] = useState<StorageRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/storage/requests?${params}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { requests: StorageRequest[] };
      setItems(data.requests);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function flip(id: number, next: StorageRequest["status"]) {
    const reasonNeeded = next === "denied";
    let reason: string | null = null;
    if (reasonNeeded) {
      const r = window.prompt("Reason for denial (optional but helpful):");
      if (r === null) return; // cancelled
      reason = r.trim() || null;
    }
    try {
      const res = await fetch("/api/storage/requests", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status: next, reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, StorageRequest[]>();
    for (const r of items) {
      const arr = m.get(r.status) ?? [];
      arr.push(r);
      m.set(r.status, arr);
    }
    return m;
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {["pending", "approved", "denied", "fulfilled", ""].map((s) => (
          <button
            key={s || "all"}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
              statusFilter === s
                ? "border-magic-red bg-magic-red/10 text-magic-red"
                : "border-magic-border bg-white text-magic-ink/70 hover:bg-magic-soft"
            }`}
          >
            {s || "all"}
          </button>
        ))}
        {hasProjectsModule && (
          <span className="ml-auto text-xs text-magic-ink/50">
            New requests are filed from a project page (Phase 7).
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-magic-ink/60">Loading requests…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-magic-ink/50 italic">
          No requests match this filter.
        </p>
      ) : (
        Array.from(grouped.entries()).map(([status, rows]) => (
          <section
            key={status}
            className="rounded-xl border border-magic-border bg-white"
          >
            <div className="border-b border-magic-border/60 px-4 py-2 bg-magic-soft/30 font-semibold text-sm text-magic-ink/80">
              {status}{" "}
              <span className="text-xs text-magic-ink/50">({rows.length})</span>
            </div>
            <ul className="divide-y divide-magic-border/40">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm">
                      <span className="font-semibold text-magic-ink">
                        {r.quantity} ×{" "}
                        {r.product_vendor && (
                          <span className="text-magic-ink/70">
                            {r.product_vendor}
                          </span>
                        )}{" "}
                        <span className="font-mono">
                          {r.product_model ?? "?"}
                        </span>
                      </span>
                    </div>
                    <div className="text-xs text-magic-ink/60 mt-0.5">
                      {r.project_name && <>project: {r.project_name} · </>}
                      {r.location_name && <>from {r.location_name} · </>}
                      by @{r.requested_by_username ?? "?"}{" "}
                      {new Date(r.created_at).toLocaleDateString()}
                      {r.handled_by_username && (
                        <>
                          {" "}
                          · handled by @{r.handled_by_username}{" "}
                          {r.handled_at &&
                            new Date(r.handled_at).toLocaleDateString()}
                        </>
                      )}
                      {r.reason && <> · {r.reason}</>}
                    </div>
                  </div>
                  {canManage && r.status === "pending" && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => void flip(r.id, "approved")}
                        className="px-2.5 py-1 text-xs font-semibold rounded border border-magic-red text-magic-red hover:bg-magic-red hover:text-white transition-colors"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => void flip(r.id, "denied")}
                        className="px-2.5 py-1 text-xs font-semibold rounded border border-amber-300 text-amber-700 hover:bg-amber-50 transition-colors"
                      >
                        Deny
                      </button>
                    </div>
                  )}
                  {canManage && r.status === "approved" && (
                    <button
                      onClick={() => void flip(r.id, "fulfilled")}
                      className="px-2.5 py-1 text-xs font-semibold rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 transition-colors"
                    >
                      Mark fulfilled
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
        active
          ? "border-magic-red text-magic-red"
          : "border-transparent text-magic-ink/60 hover:text-magic-ink"
      }`}
    >
      {children}
    </button>
  );
}
