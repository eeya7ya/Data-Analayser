"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ClipboardList,
  Plus,
  Trash2,
  GripVertical,
  Save,
  X,
  Pencil,
} from "lucide-react";
import { confirmDelete } from "@/lib/confirmDelete";

interface Template {
  id: number;
  name: string;
  items: string[];
}

const inputCls =
  "block w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm text-magic-ink focus:border-magic-red/50 focus:outline-none focus:ring-2 focus:ring-magic-red/20";

export default function ChecklistDesignerClient() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editor: null = nothing open, 0 = new, >0 = editing that id.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [items, setItems] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checklist-templates", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setTemplates(data.templates ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openNew() {
    setEditingId(0);
    setName("");
    setItems([""]);
  }
  function openEdit(t: Template) {
    setEditingId(t.id);
    setName(t.name);
    setItems(t.items.length ? [...t.items] : [""]);
  }
  function closeEditor() {
    setEditingId(null);
    setName("");
    setItems([""]);
  }

  const setItem = (i: number, v: string) =>
    setItems((prev) => prev.map((x, idx) => (idx === i ? v : x)));
  const addItem = () => setItems((prev) => [...prev, ""]);
  const removeItem = (i: number) =>
    setItems((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : [""]));

  async function save() {
    const clean = items.map((s) => s.trim()).filter(Boolean);
    if (!name.trim()) {
      setError("Give the master job a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const isNew = editingId === 0;
      const res = await fetch("/api/checklist-templates", {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isNew
            ? { name: name.trim(), items: clean }
            : { id: editingId, name: name.trim(), items: clean },
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      closeEditor();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(t: Template) {
    if (!confirmDelete(`Permanently delete the master job "${t.name}"?`)) return;
    setTemplates((prev) => prev.filter((x) => x.id !== t.id));
    try {
      await fetch(`/api/checklist-templates?id=${t.id}`, { method: "DELETE" });
    } finally {
      void load();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-magic-red">
            <ClipboardList className="h-4 w-4" />
            <span className="text-xs font-bold uppercase tracking-widest">
              Checklist Designer
            </span>
          </div>
          <h1 className="text-2xl font-bold text-magic-ink">Master jobs</h1>
          <p className="mt-1 max-w-2xl text-sm text-magic-ink/60">
            Design a reusable checklist for a type of job. When you distribute a
            project and pick a master job, its steps become that project&apos;s
            checklist automatically — and you can still edit them per project.
          </p>
        </div>
        {editingId === null && (
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 rounded-xl bg-magic-red px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-magic-red/90"
          >
            <Plus className="h-4 w-4" /> New master job
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-xl border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      {/* Editor */}
      {editingId !== null && (
        <div className="rounded-2xl border border-magic-border bg-magic-soft/20 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-magic-ink/70">
              {editingId === 0 ? "New master job" : "Edit master job"}
            </h2>
            <button
              onClick={closeEditor}
              className="rounded-lg p-1.5 text-magic-ink/50 hover:bg-white hover:text-magic-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-magic-ink/50">
            Job name
          </label>
          <input
            autoFocus
            className={`${inputCls} mb-4`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. CCTV Installation, Access Control Commissioning…"
          />

          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-magic-ink/50">
            Checklist steps
          </label>
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={i} className="flex items-center gap-2">
                <GripVertical className="h-4 w-4 flex-shrink-0 text-magic-ink/25" />
                <span className="w-5 flex-shrink-0 text-right text-xs font-mono text-magic-ink/40">
                  {i + 1}
                </span>
                <input
                  className={inputCls}
                  value={it}
                  onChange={(e) => setItem(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addItem();
                    }
                  }}
                  placeholder="Step to execute…"
                />
                <button
                  onClick={() => removeItem(i)}
                  className="flex-shrink-0 rounded-lg p-1.5 text-magic-ink/40 hover:bg-white hover:text-rose-600"
                  aria-label="Remove step"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={addItem}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/60 hover:border-magic-red/40 hover:text-magic-red"
          >
            <Plus className="h-3.5 w-3.5" /> Add step
          </button>

          <div className="mt-5 flex items-center gap-2">
            <button
              onClick={() => void save()}
              disabled={saving || !name.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-magic-red px-4 py-2 text-sm font-bold text-white hover:bg-magic-red/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : "Save master job"}
            </button>
            <button
              onClick={closeEditor}
              className="rounded-xl border border-magic-border bg-white px-4 py-2 text-sm font-medium text-magic-ink/70 hover:bg-magic-soft"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <p className="py-6 text-center text-sm text-magic-ink/40">Loading…</p>
      ) : templates.length === 0 && editingId === null ? (
        <div className="rounded-2xl border border-dashed border-magic-border p-10 text-center">
          <p className="text-sm text-magic-ink/50">
            No master jobs yet. Create one to reuse its checklist across projects.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <div
              key={t.id}
              className="flex flex-col rounded-2xl border border-magic-border bg-white p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-magic-ink">{t.name}</h3>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button
                    onClick={() => openEdit(t)}
                    className="rounded-lg p-1.5 text-magic-ink/50 hover:bg-magic-soft hover:text-magic-ink"
                    aria-label="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => void remove(t)}
                    className="rounded-lg p-1.5 text-magic-ink/40 hover:bg-rose-50 hover:text-rose-600"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs text-magic-ink/50">
                {t.items.length} step{t.items.length === 1 ? "" : "s"}
              </p>
              <ol className="mt-2 space-y-0.5 text-xs text-magic-ink/70">
                {t.items.slice(0, 5).map((it, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-magic-ink/35">{i + 1}.</span>
                    <span className="truncate">{it}</span>
                  </li>
                ))}
                {t.items.length > 5 && (
                  <li className="text-magic-ink/40">+{t.items.length - 5} more…</li>
                )}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
