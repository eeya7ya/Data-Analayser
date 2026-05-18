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

interface CheckRow {
  id: number;
  quotation_id: number;
  quotation_ref: string;
  project_name: string | null;
  client_name: string | null;
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
 * Storage-team inbox for quotation BOQ availability checks. Two
 * states:
 *   - List of pending checks (default), with a filter chip to flip
 *     into "answered (recent)" for audit.
 *   - One check selected → checklist editor where each row gets an
 *     Available / Partial / Out radio + optional note, plus a single
 *     free-form notes field for the whole reply. Submit flips the
 *     row to status='answered' and bumps the requester via the
 *     existing notifications channel.
 */
export default function StockChecksTab({
  onError,
}: {
  onError: (msg: string) => void;
}) {
  const [filter, setFilter] = useState<"pending" | "answered">("pending");
  const [rows, setRows] = useState<CheckRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stock-checks?status=${filter}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { checks: CheckRow[] };
      setRows(data.checks);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (selectedId !== null) {
    return (
      <CheckAnswerView
        id={selectedId}
        onClose={() => setSelectedId(null)}
        onSubmitted={async () => {
          setSelectedId(null);
          await refresh();
        }}
        onError={onError}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <FilterChip
          active={filter === "pending"}
          onClick={() => setFilter("pending")}
        >
          Pending
        </FilterChip>
        <FilterChip
          active={filter === "answered"}
          onClick={() => setFilter("answered")}
        >
          Answered
        </FilterChip>
        <button
          onClick={() => void refresh()}
          className="ml-auto text-xs text-magic-ink/60 hover:text-magic-red"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-magic-ink/60">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-magic-ink/60">
          {filter === "pending"
            ? "No pending checks. Inbox zero."
            : "Nothing answered recently."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-magic-border">
          <table className="min-w-full text-sm">
            <thead className="bg-magic-soft text-magic-ink/70">
              <tr>
                <th className="p-2 text-left">Ref</th>
                <th className="p-2 text-left">Project / client</th>
                <th className="p-2 text-left">Requested by</th>
                <th className="p-2 text-right">Items</th>
                <th className="p-2 text-left">Sent</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-magic-border/60">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-magic-soft/30">
                  <td className="p-2 font-mono text-xs">{r.quotation_ref}</td>
                  <td className="p-2">
                    <div className="font-medium text-magic-ink">
                      {r.project_name || "—"}
                    </div>
                    {r.client_name && (
                      <div className="text-xs text-magic-ink/60">
                        {r.client_name}
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-xs">
                    {r.requested_by_display_name ||
                      r.requested_by_username ||
                      "—"}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {r.items_json.length}
                  </td>
                  <td className="p-2 text-xs text-magic-ink/60">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="p-2 text-right">
                    <button
                      onClick={() => setSelectedId(r.id)}
                      className="rounded-md border border-magic-border px-3 py-1 text-xs font-semibold hover:bg-magic-soft"
                    >
                      {r.status === "pending" ? "Answer" : "View"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterChip({
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
      className={
        "rounded-full border px-3 py-1 text-xs font-semibold transition-colors " +
        (active
          ? "border-magic-red bg-magic-red text-white"
          : "border-magic-border text-magic-ink/70 hover:bg-magic-soft")
      }
    >
      {children}
    </button>
  );
}

function CheckAnswerView({
  id,
  onClose,
  onSubmitted,
  onError,
}: {
  id: number;
  onClose: () => void;
  onSubmitted: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [check, setCheck] = useState<CheckRow | null>(null);
  const [reply, setReply] = useState<Map<number, ReplyItem>>(new Map());
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stock-checks/${id}`, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { check: CheckRow };
        if (cancelled) return;
        setCheck(data.check);
        // Pre-fill reply state from an existing reply (when viewing an
        // already-answered check) so the editor doesn't look empty.
        if (Array.isArray(data.check.reply_json)) {
          const m = new Map<number, ReplyItem>();
          for (const r of data.check.reply_json) m.set(r.no, r);
          setReply(m);
        }
        setNotes(data.check.storage_notes ?? "");
      } catch (err) {
        if (!cancelled) onError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, onError]);

  function setItem(no: number, patch: Partial<ReplyItem>) {
    setReply((prev) => {
      const next = new Map(prev);
      const cur =
        next.get(no) ?? ({ no, status: "available", note: "" } as ReplyItem);
      next.set(no, { ...cur, ...patch });
      return next;
    });
  }

  async function submit() {
    if (!check) return;
    if (reply.size < check.items_json.length) {
      onError("Mark every item before submitting.");
      return;
    }
    setBusy(true);
    try {
      const items = check.items_json
        .map((it) => reply.get(it.no))
        .filter((x): x is ReplyItem => Boolean(x));
      const res = await fetch(`/api/stock-checks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: items, notes: notes.trim() || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await onSubmitted();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading || !check) {
    return (
      <div>
        <button
          onClick={onClose}
          className="text-xs text-magic-ink/60 hover:text-magic-red mb-3"
        >
          ← Back to inbox
        </button>
        <p className="text-sm text-magic-ink/60">Loading…</p>
      </div>
    );
  }

  const readOnly = check.status !== "pending";
  const allMarked = reply.size >= check.items_json.length;

  return (
    <div>
      <button
        onClick={onClose}
        className="text-xs text-magic-ink/60 hover:text-magic-red mb-3"
      >
        ← Back to inbox
      </button>

      <header className="mb-3">
        <h3 className="text-base font-semibold text-magic-ink">
          Stock check · {check.quotation_ref}
        </h3>
        <p className="text-xs text-magic-ink/60 mt-0.5">
          Requested by{" "}
          <strong>
            {check.requested_by_display_name ||
              check.requested_by_username ||
              "—"}
          </strong>{" "}
          on {new Date(check.created_at).toLocaleString()}
          {readOnly && (
            <>
              {" · "}
              <span className="text-emerald-700">
                Answered{" "}
                {check.answered_at &&
                  new Date(check.answered_at).toLocaleString()}{" "}
                by{" "}
                {check.answered_by_display_name ||
                  check.answered_by_username ||
                  "storage"}
              </span>
            </>
          )}
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-magic-border">
        <table className="min-w-full text-sm">
          <thead className="bg-magic-soft text-magic-ink/70">
            <tr>
              <th className="p-2 text-left">#</th>
              <th className="p-2 text-left">Item</th>
              <th className="p-2 text-right">Qty</th>
              <th className="p-2 text-left">Availability</th>
              <th className="p-2 text-left">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-magic-border/60">
            {check.items_json.map((it) => {
              const r = reply.get(it.no);
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
                    <div className="flex flex-wrap gap-1">
                      {(["available", "partial", "out"] as const).map((s) => {
                        const active = r?.status === s;
                        return (
                          <button
                            key={s}
                            type="button"
                            disabled={readOnly}
                            onClick={() => setItem(it.no, { status: s })}
                            className={
                              "rounded-full border px-2 py-0.5 text-xs font-semibold transition-colors " +
                              (active
                                ? s === "available"
                                  ? "border-emerald-400 bg-emerald-100 text-emerald-800"
                                  : s === "partial"
                                    ? "border-amber-400 bg-amber-100 text-amber-800"
                                    : "border-red-400 bg-red-100 text-red-700"
                                : "border-magic-border text-magic-ink/60 hover:bg-magic-soft disabled:opacity-60")
                            }
                          >
                            {s === "available"
                              ? "Available"
                              : s === "partial"
                                ? "Partial"
                                : "Out"}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="p-2">
                    <input
                      type="text"
                      value={r?.note ?? ""}
                      disabled={readOnly}
                      onChange={(e) =>
                        setItem(it.no, { note: e.target.value })
                      }
                      placeholder="optional"
                      className="w-full rounded-md border border-magic-border px-2 py-1 text-xs disabled:opacity-60"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3">
        <label className="block text-xs font-semibold text-magic-ink/70 mb-1">
          Notes for requester (optional)
        </label>
        <textarea
          rows={2}
          value={notes}
          disabled={readOnly}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="E.g. ETA on the out-of-stock items, alternative SKUs…"
          className="w-full rounded-md border border-magic-border px-2 py-1 text-sm disabled:opacity-60"
        />
      </div>

      {!readOnly && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !allMarked}
            title={allMarked ? "" : "Mark every item before submitting"}
            className="rounded-md bg-magic-red text-white px-4 py-1.5 text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send reply"}
          </button>
        </div>
      )}
    </div>
  );
}
