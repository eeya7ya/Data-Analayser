"use client";

import { useEffect, useState } from "react";

interface Task {
  id: number;
  title: string;
  description: string | null;
  due_at: string | null;
  priority: string;
  status: string;
  entity_type: string | null;
  entity_id: number | null;
}

export default function TasksList() {
  const [items, setItems] = useState<Task[] | null>(null);
  const [filter, setFilter] = useState<"open" | "done">("open");
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "", due_at: "", priority: "normal" });
  const [creating, setCreating] = useState(false);

  async function load() {
    setError(null);
    const data = await fetch(`/api/crm/tasks?status=${filter}`).then((r) => r.json());
    if (data.error) setError(data.error);
    setItems(data.tasks ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          description: draft.description || null,
          due_at: draft.due_at || null,
          priority: draft.priority,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "create failed");
      setShowNew(false);
      setDraft({ title: "", description: "", due_at: "", priority: "normal" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function toggle(id: number, current: string) {
    const next = current === "done" ? "open" : "done";
    setItems((cur) => cur?.map((t) => (t.id === id ? { ...t, status: next } : t)) ?? cur);
    await fetch(`/api/crm/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (next !== filter) {
      setItems((cur) => cur?.filter((t) => t.id !== id) ?? cur);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-magic-ink">Tasks</h1>
          <div className="flex rounded-lg border border-magic-border overflow-hidden text-xs font-semibold">
            {(["open", "done"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={
                  "px-3 py-1.5 capitalize " +
                  (filter === f ? "bg-magic-red text-white" : "bg-white text-magic-ink/70 hover:bg-magic-soft")
                }
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => setShowNew((s) => !s)}
          className="rounded-md bg-magic-red text-white px-4 py-2 text-sm font-semibold hover:bg-red-700"
        >
          {showNew ? "Cancel" : "New task"}
        </button>
      </div>

      {showNew && (
        <form
          onSubmit={create}
          className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3 rounded-2xl border border-magic-border bg-white p-4"
        >
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">Title</label>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">Due</label>
            <input
              type="datetime-local"
              value={draft.due_at}
              onChange={(e) => setDraft({ ...draft, due_at: e.target.value })}
              className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">Description</label>
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={2}
              className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">Priority</label>
            <select
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
              className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="md:col-span-3 flex gap-2">
            <button
              type="submit"
              disabled={creating || !draft.title.trim()}
              className="rounded-md bg-magic-ink text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create task"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {items === null ? (
        <p className="text-sm text-magic-ink/60">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-magic-ink/60">Nothing here.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((t) => (
            <li
              key={t.id}
              className="flex items-start gap-3 rounded-2xl border border-magic-border bg-white p-3"
            >
              <input
                type="checkbox"
                checked={t.status === "done"}
                onChange={() => toggle(t.id, t.status)}
                className="mt-1 h-4 w-4 accent-magic-red"
              />
              <div className="flex-1">
                <div className="font-medium text-magic-ink">{t.title}</div>
                {t.description && <div className="text-xs text-magic-ink/60 mt-0.5">{t.description}</div>}
                <div className="mt-1 flex gap-2 text-[11px] text-magic-ink/60">
                  {t.due_at && <span>Due {new Date(t.due_at).toLocaleString()}</span>}
                  <span
                    className={
                      "rounded-full px-2 py-0.5 font-semibold " +
                      (t.priority === "high"
                        ? "bg-red-100 text-red-700"
                        : t.priority === "low"
                          ? "bg-magic-soft text-magic-ink/60"
                          : "bg-amber-100 text-amber-800")
                    }
                  >
                    {t.priority}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
