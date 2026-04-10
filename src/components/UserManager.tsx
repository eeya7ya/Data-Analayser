"use client";

import { useEffect, useState } from "react";

interface U {
  id: number;
  username: string;
  display_name: string;
  role: string;
  created_at: string;
}

export default function UserManager() {
  const [users, setUsers] = useState<U[]>([]);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Edit state
  const [editId, setEditId] = useState<number | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editRole, setEditRole] = useState<"user" | "admin">("user");
  const [editPassword, setEditPassword] = useState("");
  const [editErr, setEditErr] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);

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
        body: JSON.stringify({ username, password, role, display_name: displayName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      setUsername("");
      setDisplayName("");
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
    setEditRole(u.role as "user" | "admin");
    setEditPassword("");
    setEditErr(null);
  }

  function cancelEdit() {
    setEditId(null);
    setEditErr(null);
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
        className="rounded-2xl border border-magic-border bg-white p-4 grid grid-cols-1 md:grid-cols-5 gap-3"
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
          <div className="md:col-span-5 text-xs text-red-600">{err}</div>
        )}
      </form>

      <div className="rounded-2xl border border-magic-border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-magic-header text-magic-red text-xs uppercase">
            <tr>
              <th className="p-3 text-left">ID</th>
              <th className="p-3 text-left">Username</th>
              <th className="p-3 text-left">Name</th>
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
    </div>
  );
}
