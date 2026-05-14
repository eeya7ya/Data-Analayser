"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Admin → Modules: manage per-user, per-module role grants.
 *
 * - Active grants list shows every (user, module, role) currently in
 *   force. The "Revoke" button calls PATCH (soft-revoke); the grant row
 *   itself is preserved server-side and can be re-granted later.
 * - Pending queue lists users with zero active grants. These users
 *   keep working in the app via their legacy `users.role` until an
 *   admin grants them explicit module access — the API never throws
 *   them out.
 * - The (module, role) catalogue is fetched from the server so adding
 *   a new role server-side automatically shows up here.
 */

interface Grant {
  user_id: number;
  username: string;
  module: string;
  role: string;
  granted_by: number | null;
  granted_by_username: string | null;
  created_at: string;
}

interface PendingUser {
  id: number;
  username: string;
  display_name: string;
  legacy_role: string;
}

interface ModuleRolesPayload {
  grants: Grant[];
  pending: PendingUser[];
  catalogue: Record<string, readonly string[]>;
}

export default function ModuleRolesPanel() {
  const [data, setData] = useState<ModuleRolesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/module-roles", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as ModuleRolesPayload;
      setData(payload);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const grantsByUser = useMemo(() => {
    const m = new Map<number, Grant[]>();
    for (const g of data?.grants ?? []) {
      const arr = m.get(g.user_id) ?? [];
      arr.push(g);
      m.set(g.user_id, arr);
    }
    return m;
  }, [data]);

  async function grant(userId: number, module: string, role: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/module-roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId, module, role }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(userId: number, module: string, role: string) {
    if (
      !window.confirm(
        `Revoke ${module}.${role} from user #${userId}?\n\n` +
          "The grant row stays in the database (soft-revoke) — you can " +
          "re-grant it any time and the user picks up access immediately.",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/module-roles", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId, module, role }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-magic-ink/60">Loading module roles…</p>
    );
  }

  if (error && !data) {
    return (
      <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
        {error}
      </p>
    );
  }

  if (!data) return null;

  const catalogue = data.catalogue;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-magic-border bg-white p-5">
        <h3 className="font-semibold text-magic-ink mb-1">
          Pending role assignment
          <span className="ml-2 inline-flex items-center rounded-full bg-magic-soft px-2 py-0.5 text-xs font-medium text-magic-ink/70">
            {data.pending.length}
          </span>
        </h3>
        <p className="text-sm text-magic-ink/60 mb-4">
          Users without any active module roles. They retain access via their
          legacy <code className="text-xs bg-magic-soft px-1 rounded">users.role</code>{" "}
          until you grant them a module here — nothing is locked out by
          omission.
        </p>
        {data.pending.length === 0 ? (
          <p className="text-sm text-magic-ink/50 italic">
            Everyone has at least one module role.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.pending.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-magic-border/60 px-3 py-2"
              >
                <div className="text-sm">
                  <span className="font-semibold text-magic-ink">
                    {u.display_name || u.username}
                  </span>
                  <span className="text-magic-ink/50">
                    {" "}
                    · @{u.username} · legacy {u.legacy_role}
                  </span>
                </div>
                <GrantForm
                  userId={u.id}
                  catalogue={catalogue}
                  onGrant={grant}
                  disabled={busy}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-magic-border bg-white p-5">
        <h3 className="font-semibold text-magic-ink mb-1">Active grants</h3>
        <p className="text-sm text-magic-ink/60 mb-4">
          Every active (user, module, role) triple. Revoke is soft — the
          grant row stays in the database and re-granting flips access
          back on instantly.
        </p>
        {grantsByUser.size === 0 ? (
          <p className="text-sm text-magic-ink/50 italic">
            No active grants yet.
          </p>
        ) : (
          <div className="space-y-4">
            {[...grantsByUser.entries()].map(([userId, grants]) => (
              <div key={userId} className="rounded-lg border border-magic-border/60">
                <div className="flex items-center justify-between gap-3 border-b border-magic-border/60 bg-magic-soft/30 px-3 py-2">
                  <div className="text-sm">
                    <span className="font-semibold text-magic-ink">
                      {grants[0].username}
                    </span>
                    <span className="text-magic-ink/50"> · user #{userId}</span>
                  </div>
                  <GrantForm
                    userId={userId}
                    catalogue={catalogue}
                    onGrant={grant}
                    disabled={busy}
                  />
                </div>
                <ul className="divide-y divide-magic-border/40">
                  {grants.map((g) => (
                    <li
                      key={`${g.module}.${g.role}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <div>
                        <code className="rounded bg-magic-soft px-1.5 py-0.5 text-xs font-semibold text-magic-ink">
                          {g.module}.{g.role}
                        </code>
                        <span className="ml-2 text-magic-ink/50 text-xs">
                          granted{" "}
                          {new Date(g.created_at).toLocaleDateString()}
                          {g.granted_by_username && (
                            <> by {g.granted_by_username}</>
                          )}
                        </span>
                      </div>
                      <button
                        onClick={() => revoke(g.user_id, g.module, g.role)}
                        disabled={busy}
                        className="px-2 py-1 text-xs font-medium rounded border border-magic-border text-magic-ink/70 hover:bg-magic-red/10 hover:text-magic-red disabled:opacity-50 transition-colors"
                      >
                        Revoke
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}

function GrantForm({
  userId,
  catalogue,
  onGrant,
  disabled,
}: {
  userId: number;
  catalogue: Record<string, readonly string[]>;
  onGrant: (userId: number, module: string, role: string) => Promise<void>;
  disabled: boolean;
}) {
  const modules = Object.keys(catalogue);
  const [module, setModule] = useState<string>(modules[0] ?? "crm");
  const roles = catalogue[module] ?? [];
  const [role, setRole] = useState<string>(roles[0] ?? "");

  useEffect(() => {
    const next = catalogue[module]?.[0] ?? "";
    setRole(next);
  }, [module, catalogue]);

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={module}
        onChange={(e) => setModule(e.target.value)}
        disabled={disabled}
        className="text-xs rounded border border-magic-border bg-white px-2 py-1"
      >
        {modules.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        disabled={disabled || roles.length === 0}
        className="text-xs rounded border border-magic-border bg-white px-2 py-1"
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        onClick={() => role && void onGrant(userId, module, role)}
        disabled={disabled || !role}
        className="px-2.5 py-1 text-xs font-semibold rounded bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
      >
        Grant
      </button>
    </div>
  );
}
