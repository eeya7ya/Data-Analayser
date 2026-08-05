"use client";

import { useCallback, useEffect, useState } from "react";
import Select from "@/components/Select";

/**
 * Roster widget for /projects/[id]. Always renders the current assignments;
 * the add-form and the per-row Unassign button only appear when the caller
 * is a project owner / admin / projects.manager. Server enforces the same
 * rule, the prop just toggles affordances.
 */

interface Assignment {
  id: number;
  project_id: number;
  user_id: number;
  username: string;
  role: "technical" | "engineer" | "manager";
  assigned_by: number | null;
  assigned_by_username: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_at: string;
}

interface UserLite {
  id: number;
  username: string;
  display_name: string;
}

const ROLES: Array<Assignment["role"]> = ["technical", "engineer", "manager"];

export default function ProjectAssignmentsPanel({
  projectId,
  canManage,
}: {
  projectId: number;
  canManage: boolean;
}) {
  const [items, setItems] = useState<Assignment[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/project-assignments?project_id=${projectId}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { assignments: Assignment[] };
      setItems(data.assignments);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!canManage) return;
    // /api/users/list is the minimal directory: id + username +
    // display_name only, available to every authenticated user. The
    // admin-only /api/users would 403 here for a non-admin project
    // manager and the form would be empty.
    void fetch("/api/users/list", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { users?: UserLite[] }) => {
        if (Array.isArray(data.users)) setUsers(data.users);
      })
      .catch(() => {
        // soft-fail: leave the picker empty rather than blocking the page
      });
  }, [canManage]);

  async function unassign(id: number) {
    if (
      !window.confirm(
        "Unassign? The assignment row is preserved (soft-delete) so the audit history stays intact, and you can re-assign anytime.",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch("/api/project-assignments", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function assign(payload: {
    user_id: number;
    role: Assignment["role"];
    location: string | null;
    start_date: string | null;
    end_date: string | null;
    notes: string | null;
  }) {
    setBusy(true);
    try {
      const res = await fetch("/api/project-assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: projectId, ...payload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-magic-border bg-white p-5">
      <div className="flex items-end justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-magic-ink">Team roster</h2>
          <p className="text-xs text-magic-ink/60 mt-0.5">
            Active assignments. Unassign is soft — the audit row stays put.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-magic-ink/60">Loading roster…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-magic-ink/50 italic">
          No one assigned yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li
              key={a.id}
              className="rounded-lg border border-magic-border/60 px-3 py-2 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-sm">
                  <span className="font-semibold text-magic-ink">
                    @{a.username}
                  </span>
                  <span className="ml-2 inline-flex items-center rounded-full border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                    {a.role}
                  </span>
                </div>
                <div className="text-xs text-magic-ink/60 mt-0.5">
                  {a.location && <>📍 {a.location} · </>}
                  {a.start_date && <>start {a.start_date} · </>}
                  {a.end_date && <>⏱ est. completion {a.end_date} · </>}
                  {a.notes && <>{a.notes} · </>}
                  by {a.assigned_by_username ?? "?"}{" "}
                  {new Date(a.created_at).toLocaleDateString()}
                </div>
              </div>
              {canManage && (
                <button
                  onClick={() => void unassign(a.id)}
                  disabled={busy}
                  className="px-2 py-1 text-xs font-medium rounded border border-magic-border text-magic-ink/70 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300 disabled:opacity-50 transition-colors"
                >
                  Unassign
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <AssignForm
          users={users}
          existing={items}
          disabled={busy}
          onAssign={assign}
        />
      )}

      {error && (
        <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </section>
  );
}

function AssignForm({
  users,
  existing,
  disabled,
  onAssign,
}: {
  users: UserLite[];
  existing: Assignment[];
  disabled: boolean;
  onAssign: (payload: {
    user_id: number;
    role: Assignment["role"];
    location: string | null;
    start_date: string | null;
    end_date: string | null;
    notes: string | null;
  }) => Promise<void>;
}) {
  const [userId, setUserId] = useState<number | "">("");
  const [role, setRole] = useState<Assignment["role"]>("engineer");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (userId === "" && users.length > 0) {
      setUserId(users[0].id);
    }
  }, [users, userId]);

  function reset() {
    setLocation("");
    setStartDate("");
    setEndDate("");
    setNotes("");
  }

  async function submit() {
    if (userId === "") return;
    await onAssign({
      user_id: userId,
      role,
      location: location.trim() || null,
      start_date: startDate || null,
      end_date: endDate || null,
      notes: notes.trim() || null,
    });
    reset();
  }

  const already = existing.some(
    (a) => a.user_id === userId && a.role === role,
  );

  return (
    <div className="mt-4 rounded-lg border border-dashed border-magic-border bg-magic-soft/30 p-3">
      <h3 className="text-sm font-semibold text-magic-ink mb-2">
        Assign someone
      </h3>
      <div className="grid gap-2 md:grid-cols-3">
        <Select
          value={userId}
          onChange={(next) =>
            setUserId(next === "" ? "" : Number(next))
          }
          disabled={disabled || users.length === 0}
          className="rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
        >
          {users.length === 0 ? (
            <option value="">No users available</option>
          ) : (
            users.map((u) => (
              <option key={u.id} value={u.id}>
                @{u.username}
                {u.display_name && u.display_name !== u.username
                  ? ` (${u.display_name})`
                  : ""}
              </option>
            ))
          )}
        </Select>
        <Select
          value={role}
          onChange={(next) => setRole(next as Assignment["role"])}
          disabled={disabled}
          className="rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <input
          type="text"
          placeholder="Location (optional)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          disabled={disabled}
          className="rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
        />
        <label className="flex flex-col gap-0.5 text-[10px] font-medium uppercase tracking-wide text-magic-ink/50">
          Start date
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={disabled}
            className="rounded border border-magic-border bg-white px-2 py-1.5 text-sm font-normal normal-case text-magic-ink"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] font-medium uppercase tracking-wide text-magic-ink/50">
          Est. completion (optional)
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            disabled={disabled}
            className="rounded border border-magic-border bg-white px-2 py-1.5 text-sm font-normal normal-case text-magic-ink"
          />
        </label>
        <input
          type="text"
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={disabled}
          className="rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
        />
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        {already && (
          <span className="text-xs text-magic-ink/50">
            Already assigned — Save will update the info window.
          </span>
        )}
        <button
          onClick={() => void submit()}
          disabled={disabled || userId === ""}
          className="px-3 py-1.5 text-xs font-semibold rounded bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
        >
          {already ? "Save" : "Assign"}
        </button>
      </div>
    </div>
  );
}
