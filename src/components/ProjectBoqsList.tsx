"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * BOQs / Files list with search. Groups results by kind (BOQ first,
 * then quotation / po / other), filtering each group by the query.
 * Empty groups disappear so the page doesn't show four "no matches"
 * sections when the user types a specific term.
 *
 * When `canShare` is set (sales / presales / admin / folder owner), each
 * file gets a "Share to projects" toggle. Sharing is what lets a project
 * manager / engineer who isn't the owner read the BOQ — unshared files
 * stay private to the owner.
 */

export interface ProjectFileRow {
  id: number;
  project_id: number;
  kind: string;
  filename: string;
  mime: string;
  size_bytes: number;
  storage_path: string;
  shared_to_projects?: boolean;
  /** V1.8 — shared with the sales ↔ presales counterpart on this deal. */
  shared_with_counterpart?: boolean;
  created_at: string;
}

const KIND_LABELS: Record<string, string> = {
  boq: "BOQs",
  quotation: "Quotation files",
  po: "PO files",
  other: "Other files",
};

const KIND_ORDER = ["boq", "quotation", "po", "other"] as const;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function ProjectBoqsList({
  rows,
  canShare = false,
}: {
  rows: ProjectFileRow[];
  canShare?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ProjectFileRow[]>(rows);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(rows);
  }, [rows]);

  async function toggleShare(file: ProjectFileRow) {
    const next = !file.shared_to_projects;
    setBusyId(file.id);
    setError(null);
    // Optimistic flip.
    setItems((prev) =>
      prev.map((f) =>
        f.id === file.id ? { ...f, shared_to_projects: next } : f,
      ),
    );
    try {
      const res = await fetch(`/api/project-files/${file.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shared_to_projects: next }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      // Roll back on failure.
      setItems((prev) =>
        prev.map((f) =>
          f.id === file.id ? { ...f, shared_to_projects: !next } : f,
        ),
      );
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  // V1.8 — expose (or hide) this one file to the sales ↔ presales counterpart
  // on the same deal. Same optimistic-flip + rollback shape as toggleShare.
  async function toggleCounterpart(file: ProjectFileRow) {
    const next = !file.shared_with_counterpart;
    setBusyId(file.id);
    setError(null);
    setItems((prev) =>
      prev.map((f) =>
        f.id === file.id ? { ...f, shared_with_counterpart: next } : f,
      ),
    );
    try {
      const res = await fetch(`/api/project-files/${file.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shared_with_counterpart: next }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      setItems((prev) =>
        prev.map((f) =>
          f.id === file.id ? { ...f, shared_with_counterpart: !next } : f,
        ),
      );
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const groups = useMemo(() => {
    const lc = query.trim().toLowerCase();
    const m = new Map<string, ProjectFileRow[]>();
    for (const k of KIND_ORDER) m.set(k, []);
    for (const f of items) {
      if (lc) {
        const hay = [f.filename, f.mime, KIND_LABELS[f.kind] ?? f.kind]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(lc)) continue;
      }
      const kindKey = KIND_LABELS[f.kind] ? f.kind : "other";
      m.get(kindKey)?.push(f);
    }
    return m;
  }, [items, query]);

  const nonEmptyGroups = Array.from(groups.entries()).filter(
    ([, list]) => list.length > 0,
  );

  return (
    <div className="space-y-5">
      <input
        type="search"
        placeholder="Search filename, MIME type, kind…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
      />

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </p>
      )}

      {nonEmptyGroups.length === 0 ? (
        <p className="text-sm text-magic-ink/50 italic">
          {query
            ? `No files match "${query}".`
            : "No files uploaded under this project yet."}
        </p>
      ) : (
        nonEmptyGroups.map(([kindKey, list]) => (
          <div key={kindKey}>
            <h3 className="text-sm font-semibold text-magic-ink mb-1.5">
              {KIND_LABELS[kindKey] ?? kindKey}
              <span className="ml-2 text-xs font-normal text-magic-ink/60">
                ({list.length})
              </span>
            </h3>
            <ul className="divide-y divide-magic-border/60 rounded-lg border border-magic-border overflow-hidden">
              {list.map((f) => (
                <li
                  key={f.id}
                  className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-magic-soft/40"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <a
                        href={`/api/project-files/${f.id}`}
                        className="text-sm text-magic-red hover:underline truncate"
                      >
                        {f.filename}
                      </a>
                      {f.shared_to_projects && (
                        <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                          Shared to projects
                        </span>
                      )}
                      {f.shared_with_counterpart && (
                        <span className="inline-flex items-center rounded-full border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                          Shared with counterpart
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-magic-ink/50 mt-0.5">
                      {f.mime} · {humanSize(Number(f.size_bytes))} · uploaded{" "}
                      {new Date(f.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  {canShare && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void toggleCounterpart(f)}
                        disabled={busyId === f.id}
                        title={
                          f.shared_with_counterpart
                            ? "Stop showing this file to the sales/presales counterpart on this deal"
                            : "Show this file to the sales/presales counterpart handling this deal"
                        }
                        className={`rounded-md border px-2 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                          f.shared_with_counterpart
                            ? "border-sky-300 text-sky-700 hover:bg-sky-50"
                            : "border-magic-border text-magic-ink/70 hover:bg-magic-soft"
                        }`}
                      >
                        {busyId === f.id
                          ? "…"
                          : f.shared_with_counterpart
                            ? "Hide from counterpart"
                            : "Share with counterpart"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleShare(f)}
                        disabled={busyId === f.id}
                        title={
                          f.shared_to_projects
                            ? "Stop sharing with the projects team"
                            : "Let the projects team (managers / engineers) read this file"
                        }
                        className={`rounded-md border px-2 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                          f.shared_to_projects
                            ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                            : "border-magic-border text-magic-ink/70 hover:bg-magic-soft"
                        }`}
                      >
                        {busyId === f.id
                          ? "…"
                          : f.shared_to_projects
                            ? "Unshare"
                            : "Share to projects"}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
