"use client";

import { useState } from "react";
import { Tags, ShieldCheck } from "@/lib/icons";

export interface PresalesMember {
  id: number;
  username: string;
  display_name: string | null;
  is_manager: boolean;
  has_pricing: boolean;
}

/**
 * Presales-manager control panel: toggle which presales members may open the
 * Pricing module. Managers themselves are always-on (their access is
 * automatic) and render as a locked "Auto" row. Every toggle is optimistic
 * and reverts if the API rejects it.
 */
export default function PresalesPricingAccessClient({
  initial,
}: {
  initial: PresalesMember[];
}) {
  const [members, setMembers] = useState<PresalesMember[]>(initial);
  const [pending, setPending] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function toggle(m: PresalesMember) {
    if (m.is_manager || pending.has(m.id)) return;
    const next = !m.has_pricing;
    setError(null);
    setPending((p) => new Set(p).add(m.id));
    // Optimistic flip.
    setMembers((list) =>
      list.map((x) => (x.id === m.id ? { ...x, has_pricing: next } : x)),
    );
    try {
      const res = await fetch("/api/presales/pricing-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: m.id, enabled: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
    } catch (err) {
      // Revert on failure.
      setMembers((list) =>
        list.map((x) => (x.id === m.id ? { ...x, has_pricing: !next } : x)),
      );
      setError((err as Error).message);
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(m.id);
        return n;
      });
    }
  }

  const nonManagers = members.filter((m) => !m.is_manager);

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700"
        >
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-magic-border bg-white shadow-mt-soft">
        {members.length === 0 && (
          <p className="p-6 text-center text-sm text-magic-ink/60">
            No presales members yet. Ask an admin to assign the Presales role,
            then grant pricing access here.
          </p>
        )}
        <ul className="divide-y divide-magic-border">
          {members.map((m) => {
            const name = m.display_name?.trim() || m.username;
            const busy = pending.has(m.id);
            return (
              <li
                key={m.id}
                className="flex items-center justify-between gap-4 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-magic-ink">
                    {name}
                  </p>
                  <p className="truncate text-xs text-magic-ink/50">
                    @{m.username}
                    {m.is_manager && " · Presales manager"}
                  </p>
                </div>

                {m.is_manager ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Auto
                  </span>
                ) : (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={m.has_pricing}
                    aria-label={`Pricing access for ${name}`}
                    disabled={busy}
                    onClick={() => toggle(m)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                      m.has_pricing ? "bg-emerald-500" : "bg-magic-ink/20"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        m.has_pricing ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <p className="flex items-center gap-2 text-xs text-magic-ink/50">
        <Tags className="h-3.5 w-3.5" />
        {nonManagers.filter((m) => m.has_pricing).length} of {nonManagers.length}{" "}
        presales members can open the Pricing module.
      </p>
    </div>
  );
}
