"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Delivery queue (V1.8). Lists delivery requests grouped by status and lets the
 * delivery team progress each one (schedule → out for delivery → delivered),
 * take a delivery (assign it to themselves), or cancel. Read-only for anyone
 * who can only see their own requests (canManage=false from the API).
 */

interface DeliveryRequest {
  id: number;
  source: string;
  status: string;
  priority: string;
  project_id: number | null;
  quotation_id: number | null;
  client_name: string | null;
  destination: string | null;
  contact_phone: string | null;
  notes: string | null;
  requested_by: number | null;
  assigned_driver_id: number | null;
  scheduled_at: string | null;
  delivered_at: string | null;
  created_at: string;
  requested_by_name: string | null;
  driver_name: string | null;
  project_name: string | null;
  quotation_ref: string | null;
}

const COLUMNS: Array<{ key: string; label: string; tone: string }> = [
  { key: "requested", label: "Requested", tone: "border-amber-300" },
  { key: "scheduled", label: "Scheduled", tone: "border-sky-300" },
  { key: "out_for_delivery", label: "Out for delivery", tone: "border-indigo-300" },
  { key: "delivered", label: "Delivered", tone: "border-emerald-300" },
];

const NEXT_STATUS: Record<string, { to: string; label: string } | undefined> = {
  requested: { to: "scheduled", label: "Schedule" },
  scheduled: { to: "out_for_delivery", label: "Send out" },
  out_for_delivery: { to: "delivered", label: "Mark delivered" },
};

const PRIORITY_TONE: Record<string, string> = {
  low: "text-slate-500",
  normal: "text-sky-600",
  high: "text-amber-600",
  urgent: "text-red-600",
};

export default function DeliveryClient() {
  const [requests, setRequests] = useState<DeliveryRequest[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [meId, setMeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [reqRes, meRes] = await Promise.all([
        fetch("/api/delivery/requests", { cache: "no-store" }),
        fetch("/api/auth/me", { cache: "no-store" }),
      ]);
      const data = (await reqRes.json()) as {
        requests?: DeliveryRequest[];
        canManage?: boolean;
        error?: string;
      };
      if (!reqRes.ok) throw new Error(data.error || `HTTP ${reqRes.status}`);
      setRequests(data.requests ?? []);
      setCanManage(Boolean(data.canManage));
      const me = (await meRes.json().catch(() => ({}))) as {
        user?: { id?: number };
      };
      setMeId(me.user?.id ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(id: number, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/delivery/requests/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-magic-ink/50">Loading the queue…</p>;
  }

  const cancelled = requests.filter((r) => r.status === "cancelled");

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = requests.filter((r) => r.status === col.key);
          return (
            <div key={col.key} className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wide text-magic-ink/70">
                  {col.label}
                </h3>
                <span className="text-[11px] text-magic-ink/40">
                  {items.length}
                </span>
              </div>
              {items.length === 0 ? (
                <p className="rounded-xl border border-dashed border-magic-border/70 px-3 py-6 text-center text-xs text-magic-ink/40">
                  Empty
                </p>
              ) : (
                items.map((r) => {
                  const next = NEXT_STATUS[r.status];
                  const title =
                    r.client_name || r.project_name || r.destination || "Delivery";
                  return (
                    <div
                      key={r.id}
                      className={`rounded-xl border-l-4 ${col.tone} border border-magic-border bg-white p-3 shadow-sm`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-magic-ink">
                          {title}
                        </span>
                        <span
                          className={`text-[10px] font-semibold uppercase ${
                            PRIORITY_TONE[r.priority] ?? "text-magic-ink/40"
                          }`}
                        >
                          {r.priority}
                        </span>
                      </div>
                      <div className="mt-1 space-y-0.5 text-[11px] text-magic-ink/55">
                        {r.destination && <div>📍 {r.destination}</div>}
                        {r.project_name && <div>Project: {r.project_name}</div>}
                        {r.quotation_ref && <div>Quote: {r.quotation_ref}</div>}
                        {r.contact_phone && <div>☎ {r.contact_phone}</div>}
                        <div>
                          From {r.source}
                          {r.requested_by_name ? ` · ${r.requested_by_name}` : ""}
                        </div>
                        <div>
                          Driver: {r.driver_name || "unassigned"}
                        </div>
                        {r.notes && (
                          <div className="italic text-magic-ink/45">{r.notes}</div>
                        )}
                      </div>

                      {canManage && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {next && (
                            <button
                              type="button"
                              disabled={busyId === r.id}
                              onClick={() => void patch(r.id, { status: next.to })}
                              className="rounded-md bg-magic-red px-2 py-1 text-[11px] font-semibold text-white hover:bg-magic-red/90 disabled:opacity-50"
                            >
                              {next.label}
                            </button>
                          )}
                          {meId != null &&
                            r.assigned_driver_id !== meId && (
                              <button
                                type="button"
                                disabled={busyId === r.id}
                                onClick={() =>
                                  void patch(r.id, { assigned_driver_id: meId })
                                }
                                className="rounded-md border border-magic-border px-2 py-1 text-[11px] font-semibold text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50"
                              >
                                Take
                              </button>
                            )}
                          {r.status !== "delivered" && (
                            <button
                              type="button"
                              disabled={busyId === r.id}
                              onClick={() =>
                                void patch(r.id, { status: "cancelled" })
                              }
                              className="rounded-md border border-magic-border px-2 py-1 text-[11px] font-semibold text-magic-ink/50 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>

      {cancelled.length > 0 && (
        <details className="rounded-xl border border-magic-border bg-white p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-magic-ink/50">
            Cancelled ({cancelled.length})
          </summary>
          <ul className="mt-2 space-y-1 text-[11px] text-magic-ink/45">
            {cancelled.map((r) => (
              <li key={r.id}>
                {r.client_name || r.project_name || r.destination || "Delivery"} ·
                from {r.source}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
