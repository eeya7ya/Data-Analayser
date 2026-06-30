"use client";

import { useCallback, useEffect, useState } from "react";

interface ClickEvent {
  id: number;
  user_id: number | null;
  username: string | null;
  path: string;
  label: string | null;
  tag: string | null;
  created_at: string;
}

/**
 * Admin → Syslog. Shows the most recent clicks captured across the app
 * (who · what · where · when). Rows auto-expire after one week; "Clear log"
 * wipes everything now.
 */
export default function SyslogPanel({ readOnly = false }: { readOnly?: boolean }) {
  const [events, setEvents] = useState<ClickEvent[]>([]);
  const [retentionDays, setRetentionDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/syslog", { method: "GET" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEvents(Array.isArray(data.events) ? data.events : []);
      if (typeof data.retentionDays === "number") setRetentionDays(data.retentionDays);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function clearLog() {
    if (!window.confirm("Clear the entire syslog? This can't be undone.")) return;
    setClearing(true);
    try {
      const res = await fetch("/api/syslog", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setEvents([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-magic-ink/60">
          Every click across the app is recorded here and{" "}
          <strong>automatically removed after {retentionDays} day{retentionDays === 1 ? "" : "s"}</strong>.
          Showing the {events.length} most recent.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          {!readOnly && (
            <button
              onClick={() => void clearLog()}
              disabled={clearing || events.length === 0}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {clearing ? "Clearing…" : "Clear log"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-magic-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-magic-border text-left text-xs text-magic-ink/50">
              <th className="px-3 py-2 font-semibold">When</th>
              <th className="px-3 py-2 font-semibold">User</th>
              <th className="px-3 py-2 font-semibold">Clicked</th>
              <th className="px-3 py-2 font-semibold">Element</th>
              <th className="px-3 py-2 font-semibold">Page</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && !loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-xs text-magic-ink/40">
                  No clicks recorded yet.
                </td>
              </tr>
            ) : (
              events.map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-magic-border/60 last:border-0 align-top"
                >
                  <td className="whitespace-nowrap px-3 py-2 text-magic-ink/70">
                    {formatWhen(e.created_at)}
                  </td>
                  <td className="px-3 py-2 font-medium text-magic-ink">
                    {e.username || (e.user_id ? `#${e.user_id}` : "—")}
                  </td>
                  <td className="px-3 py-2 text-magic-ink/80">{e.label || "—"}</td>
                  <td className="px-3 py-2">
                    <code className="rounded bg-magic-soft px-1.5 py-0.5 text-[11px] text-magic-ink/70">
                      {e.tag || "—"}
                    </code>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-magic-ink/60">
                    {e.path}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
