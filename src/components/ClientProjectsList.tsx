"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

/**
 * Project list shown on the client page (one level under the
 * company / individual). Includes inline search and a "+ New
 * project" form. Each row links to the deeper project drill-down
 * URL the parent passes in via `linkBase`.
 *
 * Soft on errors: list refresh failures show inline instead of
 * navigating away, so the user can keep working with the latest
 * server snapshot.
 */

export interface ClientProjectRow {
  id: number;
  folder_id: number;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export default function ClientProjectsList({
  folderId,
  initial,
  linkBase,
}: {
  folderId: number;
  initial: ClientProjectRow[];
  /** URL prefix for each row, e.g. /crm/company/5/clients/12 */
  linkBase: string;
}) {
  const [items, setItems] = useState<ClientProjectRow[]>(initial);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects?folder_id=${folderId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { projects?: ClientProjectRow[] };
      if (Array.isArray(data.projects)) setItems(data.projects);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [folderId]);

  useEffect(() => {
    // Re-pull on focus so a manager toggling another tab and coming
    // back doesn't see stale counts. Cheap because /api/projects
    // already excludes deleted rows server-side.
    function onFocus() {
      void refresh();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const visible = useMemo(() => {
    const lc = query.trim().toLowerCase();
    if (!lc) return items;
    return items.filter((p) => {
      const hay = [p.name, p.description, p.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(lc);
    });
  }, [items, query]);

  async function createProject() {
    if (!draftName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          folder_id: folderId,
          name: draftName.trim(),
          description: draftDescription.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setItems((prev) => [data.project, ...prev]);
      setDraftName("");
      setDraftDescription("");
      setCreating(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search projects by name, description, status…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-0 rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
        />
        <button
          onClick={() => setCreating((v) => !v)}
          className="rounded-lg bg-magic-red text-white px-3 py-2 text-sm font-semibold hover:bg-magic-red/90 transition-colors"
        >
          {creating ? "Cancel" : "+ New project"}
        </button>
      </div>

      {creating && (
        <div className="rounded-xl border border-dashed border-magic-border bg-white p-3 space-y-2">
          <input
            type="text"
            placeholder="Project name (required)"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            disabled={busy}
            autoFocus
            className="w-full rounded border border-magic-border bg-white px-3 py-1.5 text-sm"
          />
          <textarea
            placeholder="Description (optional)"
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            disabled={busy}
            rows={2}
            className="w-full rounded border border-magic-border bg-white px-3 py-1.5 text-sm"
          />
          <div className="flex items-center justify-end">
            <button
              onClick={() => void createProject()}
              disabled={busy || !draftName.trim()}
              className="rounded bg-magic-red text-white px-3 py-1.5 text-xs font-semibold hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
            >
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-magic-border bg-white p-8 text-center">
          <p className="text-sm text-magic-ink/60">
            {query
              ? `No projects match "${query}".`
              : "No projects yet. Use + New project to add the first one."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((p) => (
            <li
              key={p.id}
              className="rounded-xl border border-magic-border bg-white p-3 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`${linkBase}/${p.id}`}
                    className="font-semibold text-magic-ink hover:text-magic-red"
                  >
                    {p.name}
                  </Link>
                  {p.description && (
                    <p className="text-xs text-magic-ink/60 mt-0.5 line-clamp-2">
                      {p.description}
                    </p>
                  )}
                  <div className="mt-1 text-xs text-magic-ink/50">
                    status: {p.status} · updated{" "}
                    {new Date(p.updated_at).toLocaleDateString()}
                  </div>
                </div>
                <Link
                  href={`${linkBase}/${p.id}`}
                  className="shrink-0 rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft transition-colors"
                >
                  Open
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
