"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { confirmDelete } from "@/lib/confirmDelete";
import { redirectIfSessionExpired } from "@/lib/clientAuth";

/**
 * Admin → Users & Roles.
 *
 * A person can hold MULTIPLE job roles at once (e.g. both Presales and a
 * Projects Engineer). The admin ticks any combination of job roles from a
 * checklist; `Admin` and `Viewer` are exclusive top-level access levels that
 * clear every job role. The (module, role) plumbing is hidden behind friendly
 * names; assignment goes through POST /api/admin/assign-role, which takes the
 * full set of roles and makes it authoritative in one call.
 */

interface U {
  id: number;
  username: string;
  display_name: string;
  role: string;
  phone: string;
  /** Work email printed on the user's quotations / financial proposals. */
  email: string;
  /** Admin-assigned department code — leads every quotation REF (e.g. "ITD1"). */
  department_code: string;
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
    group: "Delivery",
    options: [
      { value: "delivery.driver", label: "Delivery Driver" },
      { value: "delivery.manager", label: "Delivery Manager" },
    ],
  },
  {
    group: "Showroom",
    options: [
      { value: "showroom.staff", label: "Showroom Staff" },
      { value: "showroom.manager", label: "Showroom Manager" },
    ],
  },
  {
    group: "Accounting",
    options: [
      { value: "accountant.accountant", label: "Accountant" },
      { value: "accountant.manager", label: "Accounting Manager" },
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

/** The full set of role values a user currently holds (for the checklist + chips). */
function currentRolesFor(u: U, grants: Grant[]): string[] {
  if (u.role === "admin") return ["admin"];
  if (u.role === "viewer") return ["viewer"];
  return grants.map((g) => `${g.module}.${g.role}`);
}

/** Job-role groups only (Administration access levels handled separately). */
const JOB_ROLE_GROUPS = ROLE_GROUPS.filter(
  (g) => g.group !== "Administration" && g.group !== "—",
);

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
  const [newDept, setNewDept] = useState("");
  const [newRoles, setNewRoles] = useState<string[]>(["crm.sales"]);
  const [createRolesOpen, setCreateRolesOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // Roles editor modal (multi-role checklist).
  const [rolesUser, setRolesUser] = useState<U | null>(null);
  const [rolesSaving, setRolesSaving] = useState(false);

  // Edit modal (display name / phone / email / password).
  const [editUser, setEditUser] = useState<U | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editDept, setEditDept] = useState("");
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
      // Session expired while this tab was open → bounce to login instead of
      // rendering a wall of "UNAUTHENTICATED" errors.
      if (redirectIfSessionExpired(uRes) || redirectIfSessionExpired(mRes)) return;
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

  async function assignRoles(userId: number, roles: string[]) {
    setRolesSaving(true);
    setBusyUserId(userId);
    setError(null);
    try {
      const res = await fetch("/api/admin/assign-role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId, roles }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRolesUser(null);
      await loadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRolesSaving(false);
      setBusyUserId(null);
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setCreateErr(null);
    setCreating(true);
    try {
      // Admin/Viewer are exclusive access levels; otherwise the account is a
      // plain user that then receives the chosen job-role grants.
      const accessLevel = newRoles.includes("admin")
        ? "admin"
        : newRoles.includes("viewer")
          ? "viewer"
          : "user";
      // Create the account first, then apply the full role set authoritatively.
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          role: accessLevel,
          display_name: displayName,
          phone,
          email,
          department_code: newDept,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      const newId = data.user?.id;
      if (newId && newRoles.length > 0) {
        await fetch("/api/admin/assign-role", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ user_id: newId, roles: newRoles }),
        });
      }
      setUsername("");
      setDisplayName("");
      setPhone("");
      setEmail("");
      setPassword("");
      setNewDept("");
      setNewRoles(["crm.sales"]);
      await loadAll();
    } catch (e) {
      setCreateErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function deleteUser(id: number) {
    if (!confirmDelete("Permanently delete this user?")) return;
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
    setEditDept(u.department_code || "");
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
        department_code: editDept,
      };
      if (editPassword) body.password = editPassword;
      const res = await fetch(`/api/users?id=${editUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (redirectIfSessionExpired(res)) return;
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

  /**
   * Download every user's details as a CSV (opens in Excel).
   *
   * Passwords are intentionally NOT included: they are stored only as one-way
   * PBKDF2 hashes, so the plaintext a user signs in with does not exist in the
   * database and cannot be exported. To hand someone a working credential, set
   * a new password via the Edit dialog and share that. The UTF-8 BOM keeps
   * Arabic names readable when Excel opens the file.
   */
  function exportUsers() {
    const cols = [
      "Username",
      "Display name",
      "Email",
      "Phone",
      "Department",
      "Access level",
      "Roles",
      "Created",
    ];
    const cell = (v: string) =>
      /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const accessLevel = (u: U) =>
      u.role === "admin" ? "Admin" : u.role === "viewer" ? "Viewer" : "User";
    const rows = users.map((u) => {
      const roleLabels = currentRolesFor(u, grantsByUser.get(u.id) ?? [])
        .filter((v) => v !== "admin" && v !== "viewer" && v !== "none")
        .map((v) => LABEL_BY_VALUE[v] ?? v)
        .join(" | ");
      const created = u.created_at
        ? new Date(u.created_at).toISOString().slice(0, 10)
        : "";
      return [
        u.username,
        u.display_name || "",
        u.email || "",
        u.phone || "",
        u.department_code || "",
        accessLevel(u),
        roleLabels,
        created,
      ]
        .map((v) => cell(String(v)))
        .join(",");
    });
    const csv = "﻿" + [cols.join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <p className="text-sm text-magic-ink/60">Loading users &amp; roles…</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-magic-ink">Users &amp; roles</h3>
        <button
          type="button"
          onClick={exportUsers}
          disabled={users.length === 0}
          title="Download all users' details as a CSV (Excel). Passwords are one-way hashed and cannot be exported."
          className="inline-flex items-center gap-1.5 rounded-lg border border-magic-border bg-white px-3 py-1.5 text-xs font-semibold text-magic-ink hover:border-magic-red/40 hover:text-magic-red disabled:opacity-50"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"
            />
          </svg>
          Export users
        </button>
      </div>
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-8">
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
            <input
              className="rounded-md border border-magic-border px-3 py-2 text-sm uppercase"
              placeholder="department code"
              title="Leads every quotation reference, formatted DEPT-FO<year>-<hex>"
              value={newDept}
              onChange={(e) => setNewDept(e.target.value.toUpperCase())}
            />
            <button
              type="button"
              onClick={() => setCreateRolesOpen(true)}
              className="flex min-h-[38px] flex-wrap items-center gap-1 rounded-md border border-magic-border bg-white px-2 py-1 text-left text-xs hover:border-magic-red/40"
              title="Choose roles"
            >
              <RoleChips values={newRoles} />
              <span className="ml-auto text-magic-ink/40">▾</span>
            </button>
            <button
              disabled={creating}
              className="rounded-md bg-magic-red px-3 py-2 text-sm font-semibold text-white hover:bg-magic-red/85 disabled:opacity-60"
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
              const roleValues = currentRolesFor(u, grantsByUser.get(u.id) ?? []);
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
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-magic-ink/40">
                      <span>
                        #{u.id} · {new Date(u.created_at).toLocaleDateString()}
                      </span>
                      {u.department_code && (
                        <span
                          className="rounded bg-magic-soft px-1.5 py-0.5 font-semibold text-magic-ink/70"
                          title="Department code — leads this user's quotation refs"
                        >
                          {u.department_code}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <RoleChips values={roleValues} />
                      {!readOnly && (
                        <button
                          onClick={() => setRolesUser(u)}
                          disabled={rowBusy}
                          className="rounded border border-magic-border px-2 py-1 text-[11px] font-medium text-magic-ink/70 hover:border-magic-red/40 hover:text-magic-red disabled:opacity-50"
                        >
                          Edit roles
                        </button>
                      )}
                    </div>
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
          const roleValues = currentRolesFor(u, grantsByUser.get(u.id) ?? []);
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
                <label className="text-xs text-magic-ink/60">Roles</label>
                <RoleChips values={roleValues} />
                {!readOnly && (
                  <button
                    onClick={() => setRolesUser(u)}
                    disabled={rowBusy}
                    className="rounded border border-magic-border px-2 py-1 text-[11px] font-medium text-magic-ink/70 hover:border-magic-red/40 hover:text-magic-red disabled:opacity-50"
                  >
                    Edit roles
                  </button>
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

      {/* Roles editor modal (multi-role checklist) — existing user */}
      {rolesUser && (
        <RolesEditor
          title={`Roles for ${rolesUser.username}`}
          initial={currentRolesFor(
            rolesUser,
            grantsByUser.get(rolesUser.id) ?? [],
          )}
          saving={rolesSaving}
          onCancel={() => setRolesUser(null)}
          onSave={(roles) => void assignRoles(rolesUser.id, roles)}
        />
      )}

      {/* Roles editor modal — choosing roles for a NEW user before creating */}
      {createRolesOpen && (
        <RolesEditor
          title="Roles for the new user"
          initial={newRoles}
          saving={false}
          onCancel={() => setCreateRolesOpen(false)}
          onSave={(roles) => {
            setNewRoles(roles);
            setCreateRolesOpen(false);
          }}
        />
      )}

      {/* Edit modal */}
      {editUser && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center"
          onClick={() => setEditUser(null)}
        >
          <form
            onSubmit={saveEdit}
            className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 md:rounded-2xl"
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
              className="w-full rounded-md border border-magic-border px-3 py-2 text-sm uppercase"
              placeholder="department code (leads quotation refs)"
              title="Leads every quotation reference, formatted DEPT-FO<year>-<hex>"
              value={editDept}
              onChange={(e) => setEditDept(e.target.value.toUpperCase())}
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
                className="rounded-md bg-magic-red px-3 py-2 text-sm font-semibold text-white hover:bg-magic-red/85 disabled:opacity-60"
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

/** Read-only display of the roles a user holds, as small chips. */
function RoleChips({ values }: { values: string[] }) {
  if (values.length === 0) {
    return (
      <span className="rounded-md border border-magic-border bg-magic-soft px-2 py-1 text-xs text-magic-ink/50">
        No role yet
      </span>
    );
  }
  const isGov = values.includes("admin") || values.includes("viewer");
  return (
    <>
      {values.map((v) => (
        <span
          key={v}
          className={`rounded-md px-2 py-1 text-xs ${
            isGov
              ? "border border-magic-ink/20 bg-magic-ink/5 font-medium text-magic-ink"
              : "border border-magic-border bg-white text-magic-ink/75"
          }`}
        >
          {LABEL_BY_VALUE[v] ?? v}
        </span>
      ))}
    </>
  );
}

/**
 * Multi-role checklist. Admin / Viewer are exclusive access levels (ticking
 * either clears all job roles and disables the rest); otherwise any
 * combination of job roles can be selected.
 */
function RolesEditor({
  title,
  initial,
  saving,
  onCancel,
  onSave,
}: {
  title: string;
  initial: string[];
  saving: boolean;
  onCancel: () => void;
  onSave: (roles: string[]) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(initial));
  const isAdmin = sel.has("admin");
  const isViewer = sel.has("viewer");
  const exclusive = isAdmin || isViewer;

  function pickExclusive(which: "admin" | "viewer") {
    setSel((prev) => {
      // Ticking an already-sole selection unticks it (back to "no role").
      if (prev.has(which) && prev.size === 1) return new Set();
      return new Set([which]);
    });
  }
  function toggleJob(value: string) {
    setSel((prev) => {
      const next = new Set(prev);
      next.delete("admin");
      next.delete("viewer");
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center"
      onClick={onCancel}
    >
      <div
        className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="font-semibold text-magic-ink">
            {title}
          </h3>
          <p className="mt-1 text-xs text-magic-ink/60">
            Tick any combination of job roles. Admin / Viewer are exclusive and
            clear all job roles.
          </p>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-magic-ink/50">
            Access level
          </div>
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={() => pickExclusive("admin")}
              />
              Admin (full access)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isViewer}
                onChange={() => pickExclusive("viewer")}
              />
              Viewer (read-only admin)
            </label>
          </div>
        </div>

        <div
          className={
            exclusive ? "pointer-events-none opacity-40 transition-opacity" : ""
          }
        >
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-magic-ink/50">
            Job roles (select any combination)
          </div>
          <div className="space-y-3">
            {JOB_ROLE_GROUPS.map((g) => (
              <div key={g.group}>
                <div className="mb-1 text-xs font-medium text-magic-ink/60">
                  {g.group}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {g.options.map((o) => (
                    <label
                      key={o.value}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={sel.has(o.value)}
                        disabled={exclusive}
                        onChange={() => toggleJob(o.value)}
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-magic-border px-3 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave(Array.from(sel))}
            className="rounded-md bg-magic-red px-3 py-2 text-sm font-semibold text-white hover:bg-magic-red/85 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save roles"}
          </button>
        </div>
      </div>
    </div>
  );
}
