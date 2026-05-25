"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Admin → Users & Roles (unified).
 *
 * Merges the old "Users" (legacy account) and "Modules" (per-module role
 * grants) panels into one screen. For every user you see their account,
 * their access level (user / viewer / admin), and every module role they
 * hold — and you grant / revoke module roles inline, right next to the
 * person they belong to.
 *
 * Two data sources are joined client-side:
 *   • GET /api/users               → the account list
 *   • GET /api/admin/module-roles  → active grants + the (module, role)
 *                                    catalogue, so new roles added
 *                                    server-side show up automatically.
 */

interface U {
  id: number;
  username: string;
  display_name: string;
  role: string;
  phone: string;
  created_at: string;
}

interface Grant {
  user_id: number;
  username: string;
  module: string;
  role: string;
  granted_by: number | null;
  granted_by_username: string | null;
  created_at: string;
}

type Catalogue = Record<string, readonly string[]>;

type AccessLevel = "user" | "viewer" | "admin";

const MODULE_STYLE: Record<string, string> = {
  crm: "bg-indigo-50 text-indigo-700 border-indigo-200",
  projects: "bg-cyan-50 text-cyan-700 border-cyan-200",
  storage: "bg-amber-50 text-amber-800 border-amber-200",
  admin: "bg-red-50 text-red-700 border-red-200",
  pricing: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const ACCESS_HINT: Record<AccessLevel, string> = {
  user: "Standard account — access is defined entirely by module roles below.",
  viewer: "Read-only admin — sees every admin tab but cannot save changes.",
  admin: "Full administrator — bypasses every module gate.",
};

function prettyRole(role: string): string {
  return role.replace(/_/g, " ");
}

export default function UsersAndRolesPanel({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const [users, setUsers] = useState<U[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [catalogue, setCatalogue] = useState<Catalogue>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);

  // Create-user form.
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [accessLevel, setAccessLevel] = useState<AccessLevel>("user");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // Edit modal (display name / phone / password).
  const [editUser, setEditUser] = useState<U | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editErr, setEditErr] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const [uRes, mRes] = await Promise.all([
        fetch("/api/users", { cache: "no-store" }),
        fetch("/api/admin/module-roles", { cache: "no-store" }),
      ]);
      const uData = await uRes.json();
      const mData = await mRes.json();
      if (!uRes.ok) throw new Error(uData.error || `users HTTP ${uRes.status}`);
      if (!mRes.ok) throw new Error(mData.error || `roles HTTP ${mRes.status}`);
      setUsers(uData.users || []);
      setGrants(mData.grants || []);
      setCatalogue(mData.catalogue || {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const grantsByUser = useMemo(() => {
    const m = new Map<number, Grant[]>();
    for (const g of grants) {
      const arr = m.get(g.user_id) ?? [];
      arr.push(g);
      m.set(g.user_id, arr);
    }
    return m;
  }, [grants]);

  const stats = useMemo(() => {
    const admins = users.filter((u) => u.role === "admin").length;
    const withRoles = new Set(grants.map((g) => g.user_id)).size;
    return { total: users.length, admins, withRoles, grants: grants.length };
  }, [users, grants]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setCreateErr(null);
    setCreating(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          role: accessLevel,
          display_name: displayName,
          phone,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      setUsername("");
      setDisplayName("");
      setPhone("");
      setPassword("");
      setAccessLevel("user");
      await loadAll();
    } catch (e) {
      setCreateErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function changeAccessLevel(id: number, level: AccessLevel) {
    setBusyUserId(id);
    setError(null);
    try {
      const res = await fetch(`/api/users?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: level }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      await loadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyUserId(null);
    }
  }

  async function grantRole(userId: number, module: string, role: string) {
    setBusyUserId(userId);
    setError(null);
    try {
      const res = await fetch("/api/admin/module-roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId, module, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await loadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyUserId(null);
    }
  }

  async function revokeRole(userId: number, module: string, role: string) {
    if (
      !window.confirm(
        `Revoke ${module}.${role}?\n\n` +
          "Soft-revoke — the grant row stays in the database and you can " +
          "re-grant it any time.",
      )
    )
      return;
    setBusyUserId(userId);
    setError(null);
    try {
      const res = await fetch("/api/admin/module-roles", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId, module, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await loadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyUserId(null);
    }
  }

  async function deleteUser(id: number) {
    if (!window.confirm("Delete this user?")) return;
    setBusyUserId(id);
    try {
      await fetch(`/api/users?id=${id}`, { method: "DELETE" });
      await loadAll();
    } finally {
      setBusyUserId(null);
    }
  }

  function openEdit(u: U) {
    setEditUser(u);
    setEditDisplayName(u.display_name || "");
    setEditPhone(u.phone || "");
    setEditPassword("");
    setEditErr(null);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    setEditErr(null);
    setEditSaving(true);
    try {
      const body: Record<string, string> = {
        display_name: editDisplayName,
        phone: editPhone,
      };
      if (editPassword) body.password = editPassword;
      const res = await fetch(`/api/users?id=${editUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      setEditUser(null);
      await loadAll();
    } catch (e) {
      setEditErr((e as Error).message);
    } finally {
      setEditSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-magic-ink/60">Loading users &amp; roles…</p>;
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Users" value={stats.total} />
        <StatCard label="Admins" value={stats.admins} />
        <StatCard label="With module roles" value={stats.withRoles} />
        <StatCard label="Active grants" value={stats.grants} />
      </div>

      {/* Create user */}
      {!readOnly && (
        <form
          onSubmit={createUser}
          className="rounded-2xl border border-magic-border bg-white p-4"
        >
          <h3 className="mb-3 text-sm font-semibold text-magic-ink">
            Create user
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <input
              className="rounded-md border border-magic-border px-3 py-2 text-sm"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <input
              className="rounded-md border border-magic-border px-3 py-2 text-sm"
              placeholder="display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <input
              className="rounded-md border border-magic-border px-3 py-2 text-sm"
              type="tel"
              placeholder="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <input
              className="rounded-md border border-magic-border px-3 py-2 text-sm"
              type="password"
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <select
              className="rounded-md border border-magic-border px-3 py-2 text-sm"
              value={accessLevel}
              onChange={(e) => setAccessLevel(e.target.value as AccessLevel)}
              title={ACCESS_HINT[accessLevel]}
            >
              <option value="user">Access: user</option>
              <option value="viewer">Access: viewer (read-only)</option>
              <option value="admin">Access: admin</option>
            </select>
            <button
              disabled={creating}
              className="rounded-md bg-magic-red px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create user"}
            </button>
          </div>
          <p className="mt-2 text-xs text-magic-ink/50">
            After creating, assign module roles (sales, presales, engineer…)
            in the table below — that&apos;s what defines what each person can
            do.
          </p>
          {createErr && (
            <div className="mt-2 text-xs text-red-600">{createErr}</div>
          )}
        </form>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-2xl border border-magic-border bg-white lg:block">
        <table className="w-full text-sm">
          <thead className="bg-magic-header text-xs uppercase text-magic-red">
            <tr>
              <th className="p-3 text-left">User</th>
              <th className="p-3 text-left">Access level</th>
              <th className="p-3 text-left">Module roles</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const userGrants = grantsByUser.get(u.id) ?? [];
              const rowBusy = busyUserId === u.id;
              return (
                <tr
                  key={u.id}
                  className="border-t border-magic-border align-top"
                >
                  <td className="p-3">
                    <div className="font-semibold text-magic-ink">
                      {u.username}
                    </div>
                    <div className="text-xs text-magic-ink/60">
                      {u.display_name || "—"}
                      {u.phone ? ` · ${u.phone}` : ""}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-magic-ink/40">
                      #{u.id} · {new Date(u.created_at).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="p-3">
                    {readOnly ? (
                      <span className="rounded-md border border-magic-border bg-magic-soft px-2 py-1 text-xs text-magic-ink/70">
                        {u.role}
                      </span>
                    ) : (
                      <select
                        value={u.role}
                        disabled={rowBusy}
                        title={ACCESS_HINT[u.role as AccessLevel]}
                        onChange={(e) =>
                          void changeAccessLevel(
                            u.id,
                            e.target.value as AccessLevel,
                          )
                        }
                        className="rounded-md border border-magic-border px-2 py-1 text-sm disabled:opacity-60"
                      >
                        <option value="user">user</option>
                        <option value="viewer">viewer</option>
                        <option value="admin">admin</option>
                      </select>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {userGrants.length === 0 && (
                        <span className="text-xs italic text-magic-ink/40">
                          no module roles
                        </span>
                      )}
                      {userGrants.map((g) => (
                        <RoleChip
                          key={`${g.module}.${g.role}`}
                          module={g.module}
                          role={g.role}
                          onRevoke={
                            readOnly
                              ? undefined
                              : () => revokeRole(u.id, g.module, g.role)
                          }
                          disabled={rowBusy}
                        />
                      ))}
                    </div>
                    {!readOnly && (
                      <div className="mt-2">
                        <AddRoleForm
                          catalogue={catalogue}
                          existing={userGrants}
                          disabled={rowBusy}
                          onGrant={(m, r) => grantRole(u.id, m, r)}
                        />
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap p-3 text-right">
                    {readOnly ? (
                      <span className="text-xs text-magic-ink/40">—</span>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEdit(u)}
                          className="rounded border border-magic-border px-2 py-1 text-xs font-medium text-magic-ink/70 hover:bg-magic-soft"
                        >
                          Edit
                        </button>
                        {u.role !== "admin" && (
                          <button
                            onClick={() => deleteUser(u.id)}
                            disabled={rowBusy}
                            className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 lg:hidden">
        {users.map((u) => {
          const userGrants = grantsByUser.get(u.id) ?? [];
          const rowBusy = busyUserId === u.id;
          return (
            <div
              key={u.id}
              className="space-y-3 rounded-2xl border border-magic-border bg-white p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-magic-ink">
                    {u.username}
                  </div>
                  <div className="truncate text-sm text-magic-ink/70">
                    {u.display_name || "—"}
                  </div>
                  {u.phone && (
                    <div className="mt-0.5 text-xs text-magic-ink/50">
                      {u.phone}
                    </div>
                  )}
                </div>
                <span className="font-mono text-xs text-magic-ink/40">
                  #{u.id}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-magic-ink/60">Access</label>
                {readOnly ? (
                  <span className="rounded-md border border-magic-border bg-magic-soft px-2 py-1 text-sm text-magic-ink/70">
                    {u.role}
                  </span>
                ) : (
                  <select
                    value={u.role}
                    disabled={rowBusy}
                    onChange={(e) =>
                      void changeAccessLevel(
                        u.id,
                        e.target.value as AccessLevel,
                      )
                    }
                    className="rounded-md border border-magic-border px-2 py-1 text-sm disabled:opacity-60"
                  >
                    <option value="user">user</option>
                    <option value="viewer">viewer</option>
                    <option value="admin">admin</option>
                  </select>
                )}
              </div>

              <div>
                <div className="mb-1 text-xs text-magic-ink/60">
                  Module roles
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {userGrants.length === 0 && (
                    <span className="text-xs italic text-magic-ink/40">
                      none
                    </span>
                  )}
                  {userGrants.map((g) => (
                    <RoleChip
                      key={`${g.module}.${g.role}`}
                      module={g.module}
                      role={g.role}
                      onRevoke={
                        readOnly
                          ? undefined
                          : () => revokeRole(u.id, g.module, g.role)
                      }
                      disabled={rowBusy}
                    />
                  ))}
                </div>
                {!readOnly && (
                  <div className="mt-2">
                    <AddRoleForm
                      catalogue={catalogue}
                      existing={userGrants}
                      disabled={rowBusy}
                      onGrant={(m, r) => grantRole(u.id, m, r)}
                    />
                  </div>
                )}
              </div>

              {!readOnly && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => openEdit(u)}
                    className="rounded-md border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink hover:bg-magic-soft"
                  >
                    Edit / password
                  </button>
                  {u.role !== "admin" && (
                    <button
                      onClick={() => deleteUser(u.id)}
                      disabled={rowBusy}
                      className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Edit modal */}
      {editUser && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center"
          onClick={() => setEditUser(null)}
        >
          <form
            onSubmit={saveEdit}
            className="w-full max-w-md space-y-4 rounded-t-2xl bg-white p-5 md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="font-semibold text-magic-ink">
                Edit {editUser.username}
              </h3>
              <p className="mt-1 text-xs text-magic-ink/60">
                Leave password blank to keep the current one.
              </p>
            </div>
            <input
              className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
              placeholder="display name"
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
            />
            <input
              className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
              type="tel"
              placeholder="phone"
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
            />
            <input
              className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
              type="password"
              placeholder="new password (optional)"
              value={editPassword}
              onChange={(e) => setEditPassword(e.target.value)}
            />
            {editErr && <div className="text-xs text-red-600">{editErr}</div>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditUser(null)}
                className="rounded-md border border-magic-border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                disabled={editSaving}
                className="rounded-md bg-magic-red px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-magic-border bg-white px-4 py-3">
      <div className="text-2xl font-bold text-magic-ink">{value}</div>
      <div className="text-xs text-magic-ink/50">{label}</div>
    </div>
  );
}

function RoleChip({
  module,
  role,
  onRevoke,
  disabled,
}: {
  module: string;
  role: string;
  onRevoke?: () => void;
  disabled?: boolean;
}) {
  const style = MODULE_STYLE[module] ?? "bg-gray-50 text-gray-700 border-gray-200";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${style}`}
    >
      <span className="opacity-60">{module}</span>
      <span className="font-semibold">{prettyRole(role)}</span>
      {onRevoke && (
        <button
          onClick={onRevoke}
          disabled={disabled}
          title={`Revoke ${module}.${role}`}
          className="ml-0.5 rounded-full px-1 leading-none hover:bg-black/10 disabled:opacity-40"
        >
          ×
        </button>
      )}
    </span>
  );
}

function AddRoleForm({
  catalogue,
  existing,
  onGrant,
  disabled,
}: {
  catalogue: Catalogue;
  existing: Grant[];
  onGrant: (module: string, role: string) => void;
  disabled?: boolean;
}) {
  const modules = Object.keys(catalogue);
  const [module, setModule] = useState<string>(modules[0] ?? "crm");
  const roles = catalogue[module] ?? [];
  const [role, setRole] = useState<string>(roles[0] ?? "");

  useEffect(() => {
    setRole(catalogue[module]?.[0] ?? "");
  }, [module, catalogue]);

  const already = existing.some((g) => g.module === module && g.role === role);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={module}
        onChange={(e) => setModule(e.target.value)}
        disabled={disabled}
        className="rounded border border-magic-border bg-white px-2 py-1 text-xs"
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
        className="rounded border border-magic-border bg-white px-2 py-1 text-xs"
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {prettyRole(r)}
          </option>
        ))}
      </select>
      <button
        onClick={() => role && onGrant(module, role)}
        disabled={disabled || !role || already}
        title={already ? "Already granted" : `Grant ${module}.${role}`}
        className="rounded bg-magic-red px-2 py-1 text-xs font-semibold text-white hover:bg-magic-red/90 disabled:opacity-40"
      >
        {already ? "Granted" : "+ Add role"}
      </button>
    </div>
  );
}
