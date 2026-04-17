"use client";

import { useEffect, useState } from "react";

interface Note {
  id: number;
  body: string;
  created_at: string;
  author_username?: string | null;
}

export default function NotesPanel({
  entityType,
  entityId,
}: {
  entityType: "contact" | "company" | "deal" | "task" | "quotation";
  entityId: number;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetch(
        `/api/crm/notes?entity_type=${entityType}&entity_id=${entityId}`,
      ).then((r) => r.json());
      setNotes(data.notes ?? []);
    } catch {
      /* swallow */
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, entity_type: entityType, entity_id: entityId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      setDraft("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase text-magic-ink/60 mb-3">Notes</h2>
      <div className="rounded-2xl border border-magic-border bg-white p-3 space-y-3">
        <form onSubmit={add} className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a note. Use @username to mention."
            rows={3}
            className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-magic-ink/40">@mentions notify in-app</span>
            <button
              type="submit"
              disabled={saving || !draft.trim()}
              className="rounded-md bg-magic-ink text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
            >
              {saving ? "Saving…" : "Add note"}
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </form>
        <ul className="space-y-2 max-h-80 overflow-y-auto">
          {notes.length === 0 ? (
            <li className="text-xs text-magic-ink/60">No notes yet.</li>
          ) : (
            notes.map((n) => (
              <li key={n.id} className="rounded-md border border-magic-border/60 bg-magic-soft/40 p-2">
                <div className="text-sm text-magic-ink whitespace-pre-wrap">{n.body}</div>
                <div className="text-[10px] text-magic-ink/50 mt-1">
                  {n.author_username ?? "—"} · {new Date(n.created_at).toLocaleString()}
                </div>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
