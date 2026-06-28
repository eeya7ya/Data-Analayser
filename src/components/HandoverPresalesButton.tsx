"use client";

import { useEffect, useState } from "react";

/**
 * One-click handover of ALL the current user's presales work (companies,
 * individuals, contacts, projects, quotations and leads) to a presales member.
 * Pick the member, click once, done — used by an admin who has been doing
 * presales and wants to hand the whole book to a teammate.
 */
export default function HandoverPresalesButton() {
  const [users, setUsers] = useState<Array<{ id: number; name: string }> | null>(
    null,
  );
  const [to, setTo] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/crm/handover", { cache: "no-store" });
        const d = (await res.json()) as {
          users?: Array<{ id: number; name: string }>;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || d.error) setError(d.error || "Could not load members.");
        else setUsers(d.users ?? []);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handover() {
    if (to === "") return;
    const name = users?.find((u) => u.id === to)?.name || "this member";
    if (
      !window.confirm(
        `Move ALL your presales work (companies, individuals, contacts, ` +
          `projects, quotations and leads) to ${name}?`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch("/api/crm/handover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        moved?: number;
        error?: string;
      };
      if (!res.ok || d.error) {
        setError(d.error || `Failed (HTTP ${res.status}).`);
        return;
      }
      setMsg(`Moved ${d.moved ?? 0} item${d.moved === 1 ? "" : "s"} to ${name}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-magic-border bg-white p-4 shadow-mt-soft">
      <h3 className="text-sm font-bold text-magic-ink">
        Hand over presales work
      </h3>
      <p className="mt-0.5 text-xs text-magic-ink/60">
        Move everything you own — companies, individuals, contacts, projects,
        quotations and leads — to a presales member in one click.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={to}
          onChange={(e) =>
            setTo(e.target.value === "" ? "" : Number(e.target.value))
          }
          className="rounded-lg border border-magic-border bg-white px-2.5 py-1.5 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
        >
          <option value="">
            {users === null ? "Loading…" : "Select a presales member…"}
          </option>
          {users?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void handover()}
          disabled={busy || to === ""}
          className="rounded-lg border border-magic-red bg-magic-red px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Moving…" : "Move all my presales work"}
        </button>
      </div>
      {msg && <p className="mt-2 text-xs font-semibold text-emerald-700">{msg}</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
