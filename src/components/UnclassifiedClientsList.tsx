"use client";

import { useState } from "react";
import Link from "next/link";
import { confirmDelete } from "@/lib/confirmDelete";

export interface UnclassifiedFolderRow {
  id: number;
  name: string;
  client_company: string | null;
  client_email: string | null;
  client_phone: string | null;
  company_name: string | null;
  owner_username: string | null;
  project_count: number;
  quotation_count: number;
  latest_quotation_at: string | null;
}

/**
 * Client list for the Unclassified clients page. Adds a Delete action
 * (soft-delete to Trash via DELETE /api/folders) so stray quarantine
 * folders can be cleared without going through Admin → Folders.
 */
export default function UnclassifiedClientsList({
  initial,
}: {
  initial: UnclassifiedFolderRow[];
}) {
  const [items, setItems] = useState<UnclassifiedFolderRow[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function softDelete(id: number) {
    if (
      !confirmDelete(
        "Permanently delete this folder and everything filed under it?",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/folders?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setItems((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-magic-border bg-white p-8 text-center">
        <p className="text-magic-ink/70 mb-2">No unclassified clients.</p>
        <p className="text-sm text-magic-ink/50">
          Every folder you can see already has a kind.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <ul className="space-y-2">
        {items.map((f) => (
          <li
            key={f.id}
            className="rounded-xl border border-magic-border bg-white p-4 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Link
                  href={`/folder/${f.id}`}
                  className="font-semibold text-magic-ink hover:text-magic-red"
                >
                  {f.name}
                </Link>
                <span className="ml-2 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
                  Unclassified
                </span>
                <div className="text-xs text-magic-ink/60 mt-0.5">
                  {f.company_name && <>linked: {f.company_name} · </>}
                  {f.client_company && !f.company_name && (
                    <>{f.client_company} · </>
                  )}
                  {f.client_email && <>{f.client_email} · </>}
                  {f.owner_username && <>owner @{f.owner_username}</>}
                </div>
                <div className="text-xs text-magic-ink/50 mt-1">
                  {f.project_count} project
                  {f.project_count === 1 ? "" : "s"} · {f.quotation_count}{" "}
                  quotation{f.quotation_count === 1 ? "" : "s"}
                  {f.latest_quotation_at && (
                    <>
                      {" "}
                      · latest{" "}
                      {new Date(f.latest_quotation_at).toLocaleDateString()}
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Link
                  href={`/folder/${f.id}`}
                  className="rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft transition-colors"
                >
                  Open
                </Link>
                <button
                  onClick={() => void softDelete(f.id)}
                  disabled={busy}
                  className="px-2 py-1.5 text-xs font-medium rounded border border-magic-border text-magic-ink/70 hover:bg-red-50 hover:text-red-700 hover:border-red-300 disabled:opacity-50 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
