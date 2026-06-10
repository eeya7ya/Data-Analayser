"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Admin → Users & Roles.
 *
 * One person, one role. The admin assigns a single role — Admin, Viewer,
 * or a job role (Sales, Presales Manager, Engineer, …) — and that one
 * choice defines both the person's access level and what the app shows
 * them. The (module, role) plumbing is hidden behind friendly names; the
 * assignment goes through POST /api/admin/assign-role, which sets the
 * access level and the single module grant atomically.
 */

interface U {
  id: number;
  username: string;
  display_name: string;
  role: string;
  phone: string;
  /** Work email printed on the user's quotations / financial proposals. */
  email: string;
  created_at: string;
}

interface Grant {
  user_id: number;
  module: string;
  role: string;
}

interface RoleOption {
  value: string; // "admin" | "viewer" | "none" | "<module>.<role>"
  label: string;
}

/** The single source of truth for what an admin can assign. */
const ROLE_GROUPS: Array<{ group: string; options: RoleOption[] }> = [
  {
    group: "Administration",
    options: [
      { value: "admin", label: "Admin (full access)" },
      { value: "viewer", label: "Viewer (read-only admin)" },
    ],
  },
  {
    group: "Sales & Presales",
    options: [
      { value: "crm.sales", label: "Sales" },
      { value: "crm.sales_manager", label: "Sales Manager" },
      { value: "crm.presales", label: "Presales" },
      { value: "crm.presales_manager", label: "Presales Manager" },
    ],
  },
  {
    group: "Projects",
    options: [
      { value: "projects.manager", label: "Project Manager" },
      { value: "projects.engineer", label: "Engineer" },
      { value: "projects.technical", label: "Technician" },
    ],
  },
  {
    group: "Storage",
    options: [
      { value: "storage.worker", label: "Storage Worker" },
      { value: "storage.manager", label: "Storage Manager" },
    ],
  },
  {
    group: "—",
    options: [{ value: "none", label: "No role yet" }],
  },
];

const LABEL_BY_VALUE: Record<string, string> = Object.fromEntries(
  ROLE_GROUPS.flatMap((g) => g.options.map((o) => [o.value, o.label])),
);

function roleValueFor(u: U, grants: Grant[]): string {
  if (u.role === "admin") return "admin";
  if (u.role === "viewer") return "viewer";
  const g = grants[0];
  return g ? `${g.module}.${g.role}` : "none";
}

export default function UsersAndRolesPanel({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const [users, setUsers] = useState<U[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);

  // Create-user form.
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState<string>("crm.sales");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // Edit modal (display name / phone / email / password).
  const [editUser, setEditUser] = useState<U | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
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
    const assigned = users.filter(
      (u) =>
        u.role === "admin" ||
        u.role === "viewer" ||
        (grantsByUser.get(u.id)?.length ?? 0) > 0,
    ).length;
    return { total: users.length, admins, assigned };
  }, [users, grantsByUser]);

  async function assignRole(userId: number, role: string) {
    setBusyUserId(userId);
    setError(null);
    try {
      const res = await fetch("/api/admin/assign-role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId, role }),
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

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setCreateErr(null);
    setCreating(true);
    try {
      // Create the account first (as a plain user), then apply the role.
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          role: newRole === "admin" ? "admin" : newRole === "viewer" ? "viewer" : "user",
          display_name: displayName,
          phone,
          email,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      const newId = data.user?.id;
      if (newId && newRole.includes(".")) {
        await fetch("/api/admin/assign-role", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ user_id: newId, role: newRole }),
        });
      }
      setUsername("");
      setDisplayName("");
      setPhone("");
      setEmail("");
      setPassword("");
      setNewRole("crm.sales");
      await loadAll();
    } catch (e) {
      setCreateErr((e as Error).message);
    } finally {
      setCreating(false);
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
    setEditEmail(u.email || "");
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
        email: editEmail,
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
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Users" value={stats.total} />
        <StatCard label="Admins" value={stats.admins} />
        <StatCard label="With a role" value={stats.assigned} />
      </div>

      {!readOnly && (
        <form
          onSubmit={createUser}
          className="rounded-2xl border border-magic-border bg-white p-4"
        >
          <h3 className="mb-3 text-sm font-semibold text-magic-ink">
            Create user
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-7">
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
              type="email"
              placeholder="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="rounded-md border border-magic-border px-3 py-2 text-sm"
              type="password"
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <RoleSelect
              value={newRole}
              onChange={setNewRole}
              includeNone={false}
            />
            <button
              disabled={creating}
              className="rounded-md bg-magic-red px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create user"}
            </button>
          </div>
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
              <th className="p-3 text-left">Role</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const value = roleValueFor(u, grantsByUser.get(u.id) ?? []);
              const rowBusy = busyUserId === u.id;
              return (
                <tr key={u.id} className="border-t border-magic-border align-middle">
                  <td className="p-3">
                    <div className="font-semibold text-magic-ink">
                      {u.username}
                    </div>
                    <div className="text-xs text-magic-ink/60">
                      {u.display_name || "—"}
                      {u.phone ? ` · ${u.phone}` : ""}
                      {u.email ? ` · ${u.email}` : ""}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-magic-ink/40">
                      #{u.id} · {new Date(u.created_at).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="p-3">
                    {readOnly ? (
                      <span className="rounded-md border border-magic-border bg-magic-soft px-2 py-1 text-xs text-magic-ink/70">
                        {LABEL_BY_VALUE[value] ?? value}
                      </span>
                    ) : (
                      <RoleSelect
                        value={value}
                        disabled={rowBusy}
                        onChange={(v) => void assignRole(u.id, v)}
                      />
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
          const value = roleValueFor(u, grantsByUser.get(u.id) ?? []);
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
                  {(u.phone || u.email) && (
                    <div className="mt-0.5 text-xs text-magic-ink/50">
                      {[u.phone, u.email].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
                <span className="font-mono text-xs text-magic-ink/40">
                  #{u.id}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-magic-ink/60">Role</label>
                {readOnly ? (
                  <span className="rounded-md border border-magic-border bg-magic-soft px-2 py-1 text-sm text-magic-ink/70">
                    {LABEL_BY_VALUE[value] ?? value}
                  </span>
                ) : (
                  <RoleSelect
                    value={value}
                    disabled={rowBusy}
                    onChange={(v) => void assignRole(u.id, v)}
                  />
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
              type="email"
              placeholder="email (printed on quotations)"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
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

function RoleSelect({
  value,
  onChange,
  disabled,
  includeNone = true,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  includeNone?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-magic-border bg-white px-2 py-1.5 text-sm disabled:opacity-60"
    >
      {ROLE_GROUPS.map((g) => {
        const opts = g.options.filter(
          (o) => includeNone || o.value !== "none",
        );
        if (opts.length === 0) return null;
        return (
          <optgroup key={g.group} label={g.group}>
            {opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
