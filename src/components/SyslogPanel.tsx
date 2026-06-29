"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";

interface SyslogEntry {
  id: number;
  actorId: number | null;
  actorName: string;
  verb: string;
  entityType: string;
  entityId: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

/**
 * Admin "Syslog" — one chronological feed of who did what across the app.
 * The server prunes anything older than a month on every read, so the log
 * effectively resets monthly; admins can also wipe it on demand. Viewers
 * (read-only) can read the feed but the reset control is disabled.
 */
export default function SyslogPanel({ readOnly = false }: { readOnly?: boolean }) {
  const [entries, setEntries] = useState<SyslogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/syslog?limit=500", {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        entries?: SyslogEntry[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEntries(data.entries ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function resetLog() {
    if (
      !window.confirm(
        "Clear the entire system log? This permanently deletes every recorded entry.",
      )
    )
      return;
    setResetting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/syslog", { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-magic-ink/60">
          Records every user action across the app. The log keeps the last{" "}
          <strong>month</strong> and resets automatically — older entries are
          pruned each time this page loads.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-magic-border bg-white px-3 py-1.5 text-sm font-medium text-magic-ink/80 hover:border-magic-red/40 hover:text-magic-red disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {!readOnly && (
            <button
              onClick={resetLog}
              disabled={resetting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {resetting ? "Clearing…" : "Reset log now"}
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
        <table className="w-full text-left text-sm">
          <thead className="border-b border-magic-border bg-magic-soft/50 text-xs uppercase tracking-wide text-magic-ink/55">
            <tr>
              <th className="px-3 py-2 font-semibold">When</th>
              <th className="px-3 py-2 font-semibold">User</th>
              <th className="px-3 py-2 font-semibold">Action</th>
              <th className="px-3 py-2 font-semibold">Target</th>
              <th className="px-3 py-2 font-semibold">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-magic-border/60">
            {entries === null ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-magic-ink/50">
                  Loading…
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-magic-ink/50">
                  No activity recorded yet.
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-magic-ink/70">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-magic-ink">
                    {e.actorName}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="inline-flex items-center rounded-full bg-magic-soft px-2 py-0.5 text-xs font-semibold text-magic-ink/80">
                      {e.verb}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-magic-ink/70">
                    {e.entityType}
                    {e.entityId && e.entityId !== "0" ? ` #${e.entityId}` : ""}
                  </td>
                  <td className="px-3 py-2 text-xs text-magic-ink/55">
                    {formatMeta(e.meta)}
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

/** Render the meta JSON as a compact key=value list, or "—" when empty. */
function formatMeta(meta: Record<string, unknown>): string {
  const keys = Object.keys(meta || {});
  if (keys.length === 0) return "—";
  return keys
    .map((k) => `${k}: ${typeof meta[k] === "object" ? JSON.stringify(meta[k]) : String(meta[k])}`)
    .join(" · ");
}
