"use client";

import { useEffect, useState } from "react";

interface Team {
  id: number;
  name: string;
  member_count: number;
}

interface User {
  id: number;
  username: string;
  display_name: string | null;
}

interface Member {
  team_id: number;
  user_id: number;
  role: string;
  username: string;
  display_name: string | null;
}

export default function TeamsList() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [addUser, setAddUser] = useState<string>("");

  async function load() {
    setError(null);
    const [tRes, uRes] = await Promise.all([
      fetch("/api/crm/teams").then((r) => r.json()),
      fetch("/api/crm/users").then((r) => r.json()),
    ]);
    if (tRes.error) setError(tRes.error);
    setTeams(tRes.teams ?? []);
    setUsers(uRes.users ?? []);
  }

  async function loadMembers(id: number) {
    const data = await fetch(`/api/crm/teams/${id}`).then((r) => r.json());
    setMembers(data.members ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const res = await fetch("/api/crm/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "create failed");
      return;
    }
    setNewName("");
    await load();
  }

  async function removeTeam(id: number) {
    if (!confirm("Delete this team?")) return;
    await fetch(`/api/crm/teams/${id}`, { method: "DELETE" });
    if (open === id) setOpen(null);
    await load();
  }

  async function addMember(teamId: number) {
    if (!addUser) return;
    await fetch(`/api/crm/teams/${teamId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: Number(addUser) }),
    });
    setAddUser("");
    await loadMembers(teamId);
    await load();
  }

  async function removeMember(teamId: number, userId: number) {
    await fetch(`/api/crm/teams/${teamId}?user_id=${userId}`, { method: "DELETE" });
    await loadMembers(teamId);
    await load();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-magic-ink mb-5">Teams</h1>

      <form onSubmit={create} className="flex gap-2 mb-6">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New team name"
          className="flex-1 rounded-md border border-magic-border px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-magic-red text-white px-4 py-2 text-sm font-semibold hover:bg-red-700"
        >
          Create
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {teams === null ? (
        <p className="text-sm text-magic-ink/60">Loading…</p>
      ) : teams.length === 0 ? (
        <p className="text-sm text-magic-ink/60">No teams yet.</p>
      ) : (
        <ul className="space-y-2">
          {teams.map((t) => (
            <li key={t.id} className="rounded-2xl border border-magic-border bg-white">
              <div className="flex items-center justify-between p-3">
                <div>
                  <div className="font-medium text-magic-ink">{t.name}</div>
                  <div className="text-xs text-magic-ink/60">{t.member_count} member(s)</div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const next = open === t.id ? null : t.id;
                      setOpen(next);
                      if (next != null) loadMembers(next);
                    }}
                    className="rounded-md border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft"
                  >
                    {open === t.id ? "Close" : "Manage"}
                  </button>
                  <button
                    onClick={() => removeTeam(t.id)}
                    className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {open === t.id && (
                <div className="border-t border-magic-border p-3 space-y-3">
                  <div className="flex gap-2">
                    <select
                      value={addUser}
                      onChange={(e) => setAddUser(e.target.value)}
                      className="flex-1 rounded-md border border-magic-border px-3 py-2 text-sm"
                    >
                      <option value="">Add member…</option>
                      {users
                        .filter((u) => !members.some((m) => m.user_id === u.id))
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.username} {u.display_name ? `(${u.display_name})` : ""}
                          </option>
                        ))}
                    </select>
                    <button
                      onClick={() => addMember(t.id)}
                      disabled={!addUser}
                      className="rounded-md bg-magic-ink text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                    >
                      Add
                    </button>
                  </div>
                  {members.length === 0 ? (
                    <p className="text-xs text-magic-ink/60">No members yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {members.map((m) => (
                        <li
                          key={m.user_id}
                          className="flex items-center justify-between text-sm text-magic-ink/80"
                        >
                          <span>
                            {m.username}
                            {m.display_name && (
                              <span className="text-magic-ink/40"> · {m.display_name}</span>
                            )}
                          </span>
                          <button
                            onClick={() => removeMember(t.id, m.user_id)}
                            className="text-[11px] text-red-600 hover:underline"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
