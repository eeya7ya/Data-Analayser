"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

/**
 * Quotations list with a search box. Runs client-side over the rows
 * the server already loaded for the project tab — typical projects
 * have well under 100 quotations, so client-side filtering is plenty
 * responsive and avoids a round-trip per keystroke.
 */

export interface ProjectQuotationRow {
  id: number;
  ref: string;
  project_name: string;
  client_name: string | null;
  status: string;
  sales_approved_at: string | null;
  presales_approved_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  totals_json: Record<string, unknown> | null;
  created_at: string;
}

export default function ProjectQuotationsList({
  rows,
  base,
}: {
  rows: ProjectQuotationRow[];
  base: string;
}) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const lc = query.trim().toLowerCase();
    if (!lc) return rows;
    return rows.filter((r) => {
      const hay = [r.ref, r.project_name, r.client_name, r.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(lc);
    });
  }, [rows, query]);

  return (
    <div className="space-y-3">
      <input
        type="search"
        placeholder="Search ref, project name, client, status…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
      />

      {visible.length === 0 ? (
        <p className="text-sm text-magic-ink/50 italic">
          {query
            ? `No matches for "${query}".`
            : "No quotations filed under this project yet."}
        </p>
      ) : (
        <ul className="divide-y divide-magic-border/60 rounded-lg border border-magic-border overflow-hidden">
          {visible.map((row) => (
            <li
              key={row.id}
              className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-magic-soft/40"
            >
              <div className="min-w-0">
                <Link
                  href={`${base}/quotations/${row.id}`}
                  className="font-mono text-sm font-semibold text-magic-red hover:underline"
                >
                  {row.ref}
                </Link>
                <span className="ml-2 text-sm text-magic-ink/80 truncate">
                  {row.project_name || "—"}
                </span>
                {row.client_name && (
                  <span className="ml-2 text-xs text-magic-ink/50">
                    · {row.client_name}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider">
                <span className="text-magic-ink/50">{row.status}</span>
                {row.approved_at ? (
                  <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300 px-1.5 py-0.5">
                    approved
                  </span>
                ) : row.rejected_at ? (
                  <span className="rounded-full bg-amber-50 text-amber-800 border border-amber-300 px-1.5 py-0.5">
                    rejected
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
