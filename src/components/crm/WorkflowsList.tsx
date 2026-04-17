"use client";

import { useEffect, useState } from "react";

interface Workflow {
  id: number;
  name: string;
  trigger_kind: string;
  trigger_json: Record<string, unknown>;
  actions_json: Array<Record<string, unknown>>;
  enabled: boolean;
  last_run_at: string | null;
}

export default function WorkflowsList() {
  const [items, setItems] = useState<Workflow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    minutes: 1440,
    title: "",
    body: "",
  });
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    const data = await fetch("/api/crm/workflows").then((r) => r.json());
    if (data.error) setError(data.error);
    setItems(data.workflows ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          trigger_kind: "schedule",
          trigger_json: { minutes: Number(draft.minutes) || 1440 },
          actions_json: [
            {
              kind: "notify",
              title: draft.title || draft.name,
              body: draft.body || null,
            },
          ],
          enabled: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "create failed");
      setShowNew(false);
      setDraft({ name: "", minutes: 1440, title: "", body: "" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggle(w: Workflow) {
    setItems((cur) => cur?.map((x) => (x.id === w.id ? { ...x, enabled: !w.enabled } : x)) ?? cur);
    await fetch(`/api/crm/workflows/${w.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !w.enabled }),
    });
  }

  async function remove(id: number) {
    if (!confirm("Delete this workflow?")) return;
    await fetch(`/api/crm/workflows/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-magic-ink">Workflows</h1>
        <button
          onClick={() => setShowNew((s) => !s)}
          className="rounded-md bg-magic-red text-white px-4 py-2 text-sm font-semibold hover:bg-red-700"
        >
          {showNew ? "Cancel" : "New workflow"}
        </button>
      </div>

      <p className="mb-4 text-xs text-magic-ink/60">
        Scheduled workflows run every 15 minutes via Vercel Cron and emit an in-app notification on
        the cadence you choose. Built-in reminders (task due-date, quotation expiry) run alongside
        with no setup required.
      </p>

      {showNew && (
        <form
          onSubmit={create}
          className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-3 rounded-2xl border border-magic-border bg-white p-4"
        >
          <Field label="Name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
          <Field
            label="Cadence (minutes)"
            value={String(draft.minutes)}
            onChange={(v) => setDraft({ ...draft, minutes: Number(v) || 0 })}
            type="number"
          />
          <Field
            label="Notification title"
            value={draft.title}
            onChange={(v) => setDraft({ ...draft, title: v })}
          />
          <Field
            label="Notification body"
            value={draft.body}
            onChange={(v) => setDraft({ ...draft, body: v })}
          />
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={saving || !draft.name.trim()}
              className="rounded-md bg-magic-ink text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {saving ? "Creating…" : "Create workflow"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {items === null ? (
        <p className="text-sm text-magic-ink/60">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-magic-ink/60">No workflows yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((w) => (
            <li
              key={w.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-magic-border bg-white p-3"
            >
              <div>
                <div className="font-medium text-magic-ink">{w.name}</div>
                <div className="text-xs text-magic-ink/60 mt-0.5">
                  {w.trigger_kind} ·{" "}
                  {(w.trigger_json as { minutes?: number }).minutes ?? "—"} min ·{" "}
                  {w.actions_json?.length ?? 0} action(s)
                </div>
                {w.last_run_at && (
                  <div className="text-[10px] text-magic-ink/40 mt-0.5">
                    Last run {new Date(w.last_run_at).toLocaleString()}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-magic-ink/70">
                  <input
                    type="checkbox"
                    checked={w.enabled}
                    onChange={() => toggle(w)}
                    className="accent-magic-red"
                  />
                  Enabled
                </label>
                <button
                  onClick={() => remove(w.id)}
                  className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
      />
    </div>
  );
}
