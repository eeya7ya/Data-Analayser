"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, ListChecks } from "lucide-react";
import { confirmDelete } from "@/lib/confirmDelete";

/**
 * Per-project to-do checklist. The assigned technician/engineer ticks items
 * off as they execute; the PM and owner see the progress. Renders on the
 * project detail page beneath the roster. Read-only for viewers who can see
 * the project but aren't assigned.
 */

interface Task {
  id: number;
  title: string;
  done: boolean;
  position: number;
  done_at: string | null;
  done_by_name?: string | null;
  done_by_username?: string | null;
}

export default function ProjectTasksPanel({ projectId }: { projectId: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  // `canCheck` — tick items done (assigned technician / engineer).
  // `canAuthor` — add / delete steps (project manager / owner / admin only).
  const [canCheck, setCanCheck] = useState(false);
  const [canAuthor, setCanAuthor] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/project-tasks?project_id=${projectId}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as {
        tasks?: Task[];
        can_check?: boolean;
        can_author?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setTasks(body.tasks ?? []);
      setCanCheck(Boolean(body.can_check));
      setCanAuthor(Boolean(body.can_author));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(task: Task) {
    if (!canCheck) return;
    const next = !task.done;
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, done: next } : t)),
    );
    try {
      const res = await fetch("/api/project-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, done: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      void load();
    } catch (err) {
      setError((err as Error).message);
      void load();
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setAdding(true);
    try {
      const res = await fetch("/api/project-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, title }),
      });
      const body = (await res.json()) as { task?: Task; error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setNewTitle("");
      void load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: number) {
    if (!confirmDelete("Permanently delete this task?")) return;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      const res = await fetch(`/api/project-tasks?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setError((err as Error).message);
      void load();
    }
  }

  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <section className="rounded-2xl border border-magic-border bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-magic-ink">
          <ListChecks className="h-5 w-5 text-magic-red" />
          Checklist
        </h2>
        {total > 0 && (
          <span className="text-sm font-semibold tabular-nums text-magic-ink/60">
            {done}/{total} · {pct}%
          </span>
        )}
      </div>

      {total > 0 && (
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-magic-soft">
          <div
            className={`h-full rounded-full transition-all ${
              pct >= 100 ? "bg-emerald-500" : "bg-violet-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {error && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {loading && tasks.length === 0 ? (
        <p className="py-4 text-center text-sm text-magic-ink/40">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="py-2 text-sm italic text-magic-ink/50">
          No checklist items yet.
          {canAuthor
            ? " Add the steps below — they'll reach the assigned member."
            : " Your project manager will assign the steps to execute."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map((t) => (
            <li
              key={t.id}
              className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-magic-soft/40"
            >
              <input
                type="checkbox"
                checked={t.done}
                disabled={!canCheck}
                onChange={() => toggle(t)}
                className="h-4 w-4 shrink-0 rounded border-magic-border text-magic-red focus:ring-magic-red disabled:opacity-50"
              />
              <span
                className={`flex-1 text-sm ${
                  t.done
                    ? "text-magic-ink/40 line-through"
                    : "text-magic-ink/85"
                }`}
              >
                {t.title}
              </span>
              {t.done && (t.done_by_name || t.done_by_username) && (
                <span className="hidden text-[11px] text-magic-ink/35 sm:inline">
                  {t.done_by_name || t.done_by_username}
                </span>
              )}
              {canAuthor && (
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  aria-label="Delete item"
                  className="shrink-0 rounded p-1 text-magic-ink/30 opacity-0 transition-opacity hover:text-rose-600 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canAuthor && (
        <form onSubmit={addTask} className="mt-3 flex items-center gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Add a checklist item…"
            maxLength={500}
            className="flex-1 rounded-lg border border-magic-border px-3 py-1.5 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
          />
          <button
            type="submit"
            disabled={adding || !newTitle.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-magic-red px-3 py-1.5 text-sm font-semibold text-white hover:bg-magic-red/90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </form>
      )}
    </section>
  );
}
