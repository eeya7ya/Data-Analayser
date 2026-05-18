"use client";

import { useCallback, useEffect, useState } from "react";

interface SnapshotItem {
  no: number;
  system: string;
  brand: string;
  model: string;
  description: string;
  quantity: number;
}

interface ReplyItem {
  no: number;
  status: "available" | "partial" | "out";
  note?: string;
}

interface StockCheck {
  id: number;
  quotation_id: number;
  status: "pending" | "answered" | "cancelled";
  items_json: SnapshotItem[];
  reply_json: ReplyItem[] | null;
  storage_notes: string | null;
  created_at: string;
  answered_at: string | null;
  requested_by_username?: string;
  requested_by_display_name?: string;
  answered_by_username?: string;
  answered_by_display_name?: string;
}

/**
 * Read-only side of the BOQ stock-check flow. Sits below the printed
 * preview on QuotationViewer and lets the presales engineer fire one
 * request at the warehouse + watch the reply come back.
 *
 * The panel auto-refreshes every 20s while a check is pending so the
 * user doesn't have to reload the page to see the storage team's
 * answer land. Once `status === 'answered'` the polling stops.
 */
export default function QuotationStockCheckPanel({
  quotationId,
}: {
  quotationId: number;
}) {
  const [latest, setLatest] = useState<StockCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/stock-checks?quotation_id=${quotationId}&status=all`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed to load");
      const rows = (data.checks || []) as StockCheck[];
      setLatest(rows[0] ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [quotationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Light polling while pending. 20s is a compromise between "I just
  // got an answer, I want to see it now" and "this page is going to
  // sit open all day, don't hammer the DB".
  useEffect(() => {
    if (latest?.status !== "pending") return;
    const id = setInterval(() => void load(), 20_000);
    return () => clearInterval(id);
  }, [latest?.status, load]);

  async function request() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stock-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotation_id: quotationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "request failed");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!latest) return;
    if (!confirm("Cancel this stock check? You can fire another one after.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/stock-checks/${latest.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "cancel failed");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canRequestNew = !latest || latest.status !== "pending";

  return (
    <section className="no-print mt-6 rounded-2xl border border-magic-border bg-white p-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-magic-ink">
            Stock availability
          </h3>
          <p className="text-xs text-magic-ink/60 mt-0.5">
            Send a copy of this quotation&apos;s BOQ to the storage team
            and wait for their per-item answer.
          </p>
        </div>
        {canRequestNew && (
          <button
            onClick={request}
            disabled={busy || loading}
            className="rounded-md bg-magic-red text-white px-4 py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? "Sending…" : "Check availability"}
          </button>
        )}
      </header>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {!loading && latest && (
        <div className="mt-4">
          {latest.status === "pending" && (
            <PendingBanner check={latest} onCancel={cancel} busy={busy} />
          )}
          {latest.status === "answered" && <AnsweredView check={latest} />}
          {latest.status === "cancelled" && (
            <p className="text-sm text-magic-ink/60">
              Last check was cancelled on{" "}
              {new Date(latest.created_at).toLocaleString()}. Fire a new one
              when you&apos;re ready.
            </p>
          )}
        </div>
      )}

      {!loading && !latest && (
        <p className="mt-3 text-sm text-magic-ink/60">
          No stock check yet for this quotation.
        </p>
      )}
    </section>
  );
}

function PendingBanner({
  check,
  onCancel,
  busy,
}: {
  check: StockCheck;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <div className="flex items-center justify-between gap-3">
        <div>
          <strong>Waiting for storage</strong> — sent{" "}
          {new Date(check.created_at).toLocaleString()} ({check.items_json.length}{" "}
          item{check.items_json.length === 1 ? "" : "s"}). You&apos;ll see the
          checklist here as soon as they reply.
        </div>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-amber-400 px-2 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function statusBadge(status: ReplyItem["status"]): {
  label: string;
  className: string;
} {
  if (status === "available") {
    return {
      label: "Available",
      className: "bg-emerald-100 text-emerald-800 border-emerald-300",
    };
  }
  if (status === "partial") {
    return {
      label: "Partial",
      className: "bg-amber-100 text-amber-800 border-amber-300",
    };
  }
  return {
    label: "Out of stock",
    className: "bg-red-100 text-red-700 border-red-300",
  };
}

function AnsweredView({ check }: { check: StockCheck }) {
  const reply = check.reply_json ?? [];
  const byNo = new Map(reply.map((r) => [r.no, r] as const));
  const answeredBy =
    check.answered_by_display_name || check.answered_by_username || "storage";

  const summary = {
    available: reply.filter((r) => r.status === "available").length,
    partial: reply.filter((r) => r.status === "partial").length,
    out: reply.filter((r) => r.status === "out").length,
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-magic-ink/70">
        <span>
          Answered by <strong>{answeredBy}</strong>
          {check.answered_at && (
            <> on {new Date(check.answered_at).toLocaleString()}</>
          )}
        </span>
        <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 font-semibold">
          {summary.available} available
        </span>
        {summary.partial > 0 && (
          <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 font-semibold">
            {summary.partial} partial
          </span>
        )}
        {summary.out > 0 && (
          <span className="inline-flex items-center rounded-full bg-red-100 text-red-700 border border-red-300 px-2 py-0.5 font-semibold">
            {summary.out} out
          </span>
        )}
      </div>

      {check.storage_notes && (
        <div className="rounded-md border border-magic-border bg-magic-soft/40 px-3 py-2 text-xs text-magic-ink/80">
          <strong>Storage notes:</strong> {check.storage_notes}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-magic-border">
        <table className="min-w-full text-sm">
          <thead className="bg-magic-soft text-magic-ink/70">
            <tr>
              <th className="p-2 text-left">#</th>
              <th className="p-2 text-left">Item</th>
              <th className="p-2 text-right">Qty</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-magic-border/60">
            {check.items_json.map((it) => {
              const r = byNo.get(it.no);
              const badge = r ? statusBadge(r.status) : null;
              return (
                <tr key={it.no}>
                  <td className="p-2 text-xs text-magic-ink/60">{it.no}</td>
                  <td className="p-2">
                    <div className="font-medium text-magic-ink">
                      {it.brand} {it.model}
                    </div>
                    {it.description && (
                      <div className="text-xs text-magic-ink/60">
                        {it.description}
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-right tabular-nums">{it.quantity}</td>
                  <td className="p-2">
                    {badge ? (
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    ) : (
                      <span className="text-xs text-magic-ink/40">—</span>
                    )}
                  </td>
                  <td className="p-2 text-xs text-magic-ink/70">
                    {r?.note || ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
