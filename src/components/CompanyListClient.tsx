"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EditCompanyDialog } from "@/components/EditCompanyDialog";
import MoveOwnerButton from "@/components/MoveOwnerButton";
import { useNameConflicts } from "@/components/useNameConflicts";
import { LIST_SORT_OPTIONS, sortList, type ListSortKey } from "@/lib/listSort";

/**
 * Companies list with client-side search + "+ New" modal. Server
 * returns up to 500 rows for the user; we filter client-side which is
 * fine at this scale (17 rows today, headroom to grow). Creating a
 * new company shows it instantly because POST returns the new row
 * and we splice it into local state.
 */

interface Company {
  id: number;
  name: string;
  website: string | null;
  industry: string | null;
  size_bucket: string | null;
  notes: string | null;
  client_count: number;
  quotation_count: number;
  file_count: number;
  created_at: string | null;
  deleted_at: string | null;
}

export default function CompanyListClient({
  initial,
  backTool = "",
}: {
  initial: Company[];
  /** e.g. "?tool=presales" — carried onto each company link so the detail
   * page can link back to the originating CRM hub tab. */
  backTool?: string;
}) {
  const [items, setItems] = useState<Company[]>(initial);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<ListSortKey>("name-asc");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (q?: string) => {
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      const res = await fetch(`/api/companies?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { companies: Company[] };
      setItems(data.companies);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function softDelete(id: number) {
    if (
      !window.confirm(
        "Delete this company? It moves to Trash and can be restored from there.",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/companies?id=${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setItems((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const visible = useMemo(() => {
    const lc = query.trim().toLowerCase();
    const filtered = !lc
      ? items
      : items.filter((c) => {
          const hay = [c.name, c.website, c.industry, c.notes]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(lc);
        });
    return sortList(filtered, sortKey);
  }, [items, query, sortKey]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search company name, website, industry…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-0 rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-1.5 text-xs text-magic-ink/60">
          <span className="hidden sm:inline">Sort</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as ListSortKey)}
            aria-label="Sort companies"
            className="rounded-lg border border-magic-border bg-white px-2 py-2 text-sm text-magic-ink"
          >
            {LIST_SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <Link
          href="/crm/trash"
          className="rounded-lg border border-magic-border px-3 py-2 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft transition-colors"
        >
          Trash
        </Link>
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-magic-red text-white px-3 py-2 text-sm font-semibold hover:bg-magic-red/90 transition-colors"
        >
          + New company
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-magic-border bg-white p-8 text-center">
          <p className="text-sm text-magic-ink/60">
            {query
              ? `No companies match "${query}".`
              : "No companies yet. Use + New company to add the first one."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border border-magic-border bg-white p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <Link
                    href={`/crm/company/${c.id}${backTool}`}
                    className="font-semibold text-magic-ink hover:text-magic-red"
                  >
                    {c.name}
                  </Link>
                  <div className="text-xs text-magic-ink/60 mt-0.5">
                    {c.industry && <>{c.industry} · </>}
                    {c.website && (
                      <a
                        href={
                          c.website.startsWith("http")
                            ? c.website
                            : `https://${c.website}`
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-magic-red"
                      >
                        {c.website}
                      </a>
                    )}
                  </div>
                  <div className="text-xs text-magic-ink/50 mt-1">
                    {c.client_count} client{c.client_count === 1 ? "" : "s"} ·{" "}
                    {c.quotation_count} quotation
                    {c.quotation_count === 1 ? "" : "s"} ·{" "}
                    {c.file_count} file{c.file_count === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Link
                    href={`/crm/company/${c.id}${backTool}`}
                    className="rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft transition-colors"
                  >
                    Open
                  </Link>
                  <button
                    onClick={() => setEditing(c)}
                    disabled={busy}
                    className="px-2 py-1.5 text-xs font-medium rounded border border-magic-border text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50 transition-colors"
                  >
                    Edit
                  </button>
                  <MoveOwnerButton
                    kind="company"
                    id={c.id}
                    name={c.name}
                    onMoved={() => void refresh(query)}
                  />
                  <button
                    onClick={() => void softDelete(c.id)}
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
      )}

      {creating && (
        <NewCompanyModal
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setItems((prev) => [c, ...prev]);
            setCreating(false);
          }}
        />
      )}

      {editing && (
        <EditCompanyDialog
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            setItems((prev) => prev.map((it) => (it.id === c.id ? { ...it, ...c } : it)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function NewCompanyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c: Company) => void;
}) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conflicts = useNameConflicts(name, "company");

  async function submit() {
    if (!name.trim() || conflicts.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          website: website.trim() || null,
          industry: industry.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onCreated(data.company);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-magic-ink/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-magic-ink">New company</h3>
          <button
            onClick={onClose}
            className="text-magic-ink/50 hover:text-magic-ink"
          >
            ×
          </button>
        </div>
        <input
          type="text"
          placeholder="Company name (required)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          autoFocus
          className="w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
        />
        {conflicts.length > 0 && (
          <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
            “{conflicts[0].name}” already exists as an individual client. A name
            can’t be both an individual and a company — rename one to continue.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            placeholder="Website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            disabled={busy}
            className="rounded border border-magic-border bg-white px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            disabled={busy}
            className="rounded border border-magic-border bg-white px-3 py-2 text-sm"
          />
        </div>
        <textarea
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
          rows={3}
          className="w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
        />
        {error && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !name.trim() || conflicts.length > 0}
            className="rounded bg-magic-red text-white px-3 py-1.5 text-xs font-semibold hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
          >
            {busy ? "Creating…" : "Create company"}
          </button>
        </div>
      </div>
    </div>
  );
}
