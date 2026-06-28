"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "Move owner" control for a company or individual client. Opens a small
 * popover that lists the presales users in the tenant and reassigns the client
 * (and everything filed under it) to the chosen one via /api/crm/reassign-owner.
 *
 * Visibility is owner-scoped, so this is how a presales person hands a client
 * over to a colleague — the new owner inherits the whole client.
 */
export default function MoveOwnerButton({
  kind,
  id,
  name,
  onMoved,
}: {
  kind: "company" | "individual";
  id: number;
  /** Client name, shown in the confirmation copy. */
  name?: string;
  /** Called after a successful move so the caller can refresh its list. */
  onMoved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<Array<{ id: number; name: string }> | null>(
    null,
  );
  const [target, setTarget] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Load the presales users the first time the popover opens.
  useEffect(() => {
    if (!open || users !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/crm/reassign-owner", { cache: "no-store" });
        const d = (await res.json()) as {
          users?: Array<{ id: number; name: string }>;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || d.error) setError(d.error || "Could not load users.");
        else setUsers(d.users ?? []);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, users]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function move() {
    if (target === "") return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/reassign-owner", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, id, owner_id: target }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || d.error) {
        setError(d.error || `Move failed (HTTP ${res.status}).`);
        return;
      }
      setOpen(false);
      setTarget("");
      onMoved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Move this client to another presales user"
        className="rounded border border-magic-border px-2 py-1 text-xs font-medium text-magic-ink/70 hover:bg-magic-soft"
      >
        Move owner
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-magic-border bg-white p-3 shadow-mt-lift">
          <p className="mb-2 text-xs text-magic-ink/60">
            Move{" "}
            <span className="font-semibold text-magic-ink">{name || "this client"}</span>{" "}
            and everything filed under it to:
          </p>
          <select
            value={target}
            onChange={(e) =>
              setTarget(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="w-full rounded-md border border-magic-border bg-white px-2 py-1.5 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
          >
            <option value="">
              {users === null ? "Loading…" : "Select a presales user…"}
            </option>
            {users?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-magic-border px-2.5 py-1 text-xs font-medium text-magic-ink/70 hover:bg-magic-soft"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void move()}
              disabled={busy || target === ""}
              className="rounded border border-magic-red bg-magic-red px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Moving…" : "Move"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
