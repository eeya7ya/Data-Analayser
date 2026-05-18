"use client";

import { useEffect, useState } from "react";

interface U {
  id: number;
  username: string;
  display_name: string;
  role: string;
  phone: string;
  created_at: string;
}

export default function UserManager() {
  const [users, setUsers] = useState<U[]>([]);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Edit state
  const [editId, setEditId] = useState<number | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editRole, setEditRole] = useState<"user" | "admin">("user");
  const [editPassword, setEditPassword] = useState("");
  const [editErr, setEditErr] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  // Mobile quick-actions: inline role select fires PATCH immediately,
  // password reset opens a small sheet so the input gets focus + a
  // dedicated submit button on touch screens.
  const [mobileBusyId, setMobileBusyId] = useState<number | null>(null);
  const [mobileErrId, setMobileErrId] = useState<number | null>(null);
  const [mobileErr, setMobileErr] = useState<string | null>(null);

  const [pwSheetId, setPwSheetId] = useState<number | null>(null);
  const [pwSheetUsername, setPwSheetUsername] = useState("");
  const [pwValue, setPwValue] = useState("");
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwLoading, setPwLoading] = useState(false);

  async function load() {
    const res = await fetch("/api/users");
    const data = await res.json();
    setUsers(data.users || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          role,
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
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this user?")) return;
    await fetch(`/api/users?id=${id}`, { method: "DELETE" });
    await load();
  }

  function startEdit(u: U) {
    setEditId(u.id);
    setEditDisplayName(u.display_name || "");
    setEditPhone(u.phone || "");
    setEditRole(u.role as "user" | "admin");
    setEditPassword("");
    setEditErr(null);
  }

  function cancelEdit() {
    setEditId(null);
    setEditErr(null);
  }

  async function quickRoleChange(id: number, role: "user" | "admin") {
    setMobileBusyId(id);
    setMobileErr(null);
    setMobileErrId(null);
    try {
      const res = await fetch(`/api/users?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      await load();
    } catch (e) {
      setMobileErr((e as Error).message);
      setMobileErrId(id);
    } finally {
      setMobileBusyId(null);
    }
  }

  function openPwSheet(u: U) {
    setPwSheetId(u.id);
    setPwSheetUsername(u.username);
    setPwValue("");
    setPwErr(null);
  }

  function closePwSheet() {
    setPwSheetId(null);
    setPwValue("");
    setPwErr(null);
  }

  async function submitPw() {
    if (pwSheetId === null || !pwValue) return;
    setPwLoading(true);
    setPwErr(null);
    try {
      const res = await fetch(`/api/users?id=${pwSheetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwValue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      closePwSheet();
    } catch (e) {
      setPwErr((e as Error).message);
    } finally {
      setPwLoading(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (editId === null) return;
    setEditErr(null);
    setEditLoading(true);
    try {
      const body: Record<string, string> = {
        display_name: editDisplayName,
        role: editRole,
        phone: editPhone,
      };
      if (editPassword) body.password = editPassword;
      const res = await fetch(`/api/users?id=${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      setEditId(null);
      await load();
    } catch (e) {
      setEditErr((e as Error).message);
    } finally {
      setEditLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={create}
        className="rounded-2xl border border-magic-border bg-white p-4 grid grid-cols-1 md:grid-cols-6 gap-3"
      >
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
          placeholder="phone (presales)"
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
          value={role}
          onChange={(e) => setRole(e.target.value as "user" | "admin")}
        >
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <button
          disabled={loading}
          className="rounded-md bg-magic-red text-white px-3 py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
        >
          {loading ? "Creating…" : "Create user"}
        </button>
        {err && (
          <div className="md:col-span-6 text-xs text-red-600">{err}</div>
        )}
      </form>

      <div className="hidden md:block rounded-2xl border border-magic-border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-magic-header text-magic-red text-xs uppercase">
            <tr>
              <th className="p-3 text-left">ID</th>
              <th className="p-3 text-left">Username</th>
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-left">Phone</th>
              <th className="p-3 text-left">Role</th>
              <th className="p-3 text-left">Created</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              editId === u.id ? (
                <tr key={u.id} className="border-t border-magic-border bg-amber-50/50">
                  <td className="p-3 font-mono">{u.id}</td>
                  <td className="p-3 text-magic-ink/60">{u.username}</td>
                  <td className="p-2">
                    <input
                      className="rounded-md border border-magic-border px-2 py-1 text-sm w-full"
                      placeholder="display name"
                      value={editDisplayName}
                      onChange={(e) => setEditDisplayName(e.target.value)}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      className="rounded-md border border-magic-border px-2 py-1 text-sm w-full"
                      type="tel"
                      placeholder="phone"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                    />
                  </td>
                  <td className="p-2">
                    <select
                      className="rounded-md border border-magic-border px-2 py-1 text-sm"
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as "user" | "admin")}
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="p-2">
                    <input
                      className="rounded-md border border-magic-border px-2 py-1 text-sm w-full"
                      type="password"
                      placeholder="new password (optional)"
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                    />
                  </td>
                  <td className="p-2 text-right space-x-2 whitespace-nowrap">
                    <button
                      onClick={saveEdit}
                      disabled={editLoading}
                      className="rounded-md bg-green-600 text-white px-3 py-1 text-xs font-semibold hover:bg-green-700 disabled:opacity-60"
                    >
                      {editLoading ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="rounded-md border border-magic-border px-3 py-1 text-xs hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                    {editErr && (
                      <span className="text-xs text-red-600 block mt-1">{editErr}</span>
                    )}
                  </td>
                </tr>
              ) : (
                <tr key={u.id} className="border-t border-magic-border">
                  <td className="p-3 font-mono">{u.id}</td>
                  <td className="p-3">{u.username}</td>
                  <td className="p-3">{u.display_name || "—"}</td>
                  <td className="p-3">{u.phone || "—"}</td>
                  <td className="p-3">{u.role}</td>
                  <td className="p-3 text-xs text-magic-ink/60">
                    {new Date(u.created_at).toLocaleString()}
                  </td>
                  <td className="p-3 text-right space-x-2 whitespace-nowrap">
                    <button
                      onClick={() => startEdit(u)}
                      className="text-blue-600 text-xs hover:underline"
                    >
                      Edit
                    </button>
                    {u.role !== "admin" && (
                      <button
                        onClick={() => remove(u.id)}
                        className="text-red-500 text-xs hover:underline"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-3">
        {users.map((u) => (
          <div
            key={u.id}
            className="rounded-2xl border border-magic-border bg-white p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-magic-ink truncate">
                  {u.username}
                </div>
                <div className="text-sm text-magic-ink/70 truncate">
                  {u.display_name || "—"}
                </div>
                {u.phone && (
                  <div className="text-xs text-magic-ink/50 mt-0.5">
                    {u.phone}
                  </div>
                )}
              </div>
              <span className="text-xs font-mono text-magic-ink/40">
                #{u.id}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-magic-ink/60">Role</label>
              <select
                value={u.role}
                disabled={mobileBusyId === u.id}
                onChange={(e) =>
                  void quickRoleChange(u.id, e.target.value as "user" | "admin")
                }
                className="rounded-md border border-magic-border px-2 py-1 text-sm disabled:opacity-60"
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
              {mobileBusyId === u.id && (
                <span className="text-xs text-magic-ink/50">saving…</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => openPwSheet(u)}
                className="rounded-md border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink hover:bg-magic-soft"
              >
                Reset password
              </button>
              {u.role !== "admin" && (
                <button
                  onClick={() => remove(u.id)}
                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              )}
            </div>
            {mobileErrId === u.id && mobileErr && (
              <div className="text-xs text-red-600">{mobileErr}</div>
            )}
          </div>
        ))}
      </div>

      {pwSheetId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center"
          onClick={closePwSheet}
        >
          <div
            className="w-full max-w-md rounded-t-2xl bg-white p-5 space-y-4 md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="font-semibold text-magic-ink">
                Reset password for {pwSheetUsername}
              </h3>
              <p className="text-xs text-magic-ink/60 mt-1">
                The user signs in with this new password next time.
              </p>
            </div>
            <input
              type="password"
              autoFocus
              className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
              placeholder="new password"
              value={pwValue}
              onChange={(e) => setPwValue(e.target.value)}
            />
            {pwErr && <div className="text-xs text-red-600">{pwErr}</div>}
            <div className="flex justify-end gap-2">
              <button
                onClick={closePwSheet}
                className="rounded-md border border-magic-border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={submitPw}
                disabled={pwLoading || !pwValue}
                className="rounded-md bg-magic-red text-white px-3 py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
              >
                {pwLoading ? "Saving…" : "Save password"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
