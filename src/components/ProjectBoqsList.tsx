"use client";

import { useMemo, useState } from "react";

/**
 * BOQs / Files list with search. Groups results by kind (BOQ first,
 * then quotation / po / other), filtering each group by the query.
 * Empty groups disappear so the page doesn't show four "no matches"
 * sections when the user types a specific term.
 */

export interface ProjectFileRow {
  id: number;
  project_id: number;
  kind: string;
  filename: string;
  mime: string;
  size_bytes: number;
  storage_path: string;
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

export default function ProjectBoqsList({ rows }: { rows: ProjectFileRow[] }) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const lc = query.trim().toLowerCase();
    const m = new Map<string, ProjectFileRow[]>();
    for (const k of KIND_ORDER) m.set(k, []);
    for (const f of rows) {
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
  }, [rows, query]);

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
                    <a
                      href={`/api/project-files/${f.id}`}
                      className="text-sm text-magic-red hover:underline truncate"
                    >
                      {f.filename}
                    </a>
                    <div className="text-xs text-magic-ink/50 mt-0.5">
                      {f.mime} · {humanSize(Number(f.size_bytes))} · uploaded{" "}
                      {new Date(f.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
