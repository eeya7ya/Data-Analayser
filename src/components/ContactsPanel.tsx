"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

/**
 * Contacts panel for the company / folder pages. Lists named people
 * with inline search, "+ New contact" form, and per-row edit /
 * delete. Delete is soft — the row gets `deleted_at` set and the
 * linked project folder is cascade-soft-deleted alongside it, so the
 * pair surfaces in the Trash bin where they can be restored together.
 *
 * When `linkBase` is provided, each row becomes a link to that
 * person's project folder (e.g. /crm/company/123/clients/456),
 * unifying the old "People" and "Clients at this company" lists into
 * one drill-through entry point.
 */

export interface ContactRow {
  id: number;
  owner_id: number | null;
  folder_id: number | null;
  company_id: number | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  notes: string | null;
  deleted_at: string | null;
  project_count?: number;
  quotation_count?: number;
}

function displayName(c: ContactRow): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return name || c.email || c.phone || `Contact #${c.id}`;
}

export default function ContactsPanel({
  initial,
  companyId,
  folderId,
  linkBase,
}: {
  initial: ContactRow[];
  /** Pass when the panel sits inside a Company page. */
  companyId: number | null;
  /** Pass when the panel sits inside a Client (folder) page. */
  folderId: number | null;
  /**
   * If set, each contact row turns into a link to
   * `${linkBase}/${folder_id}` so the company-level "People" list also
   * drills into each person's project folder.
   */
  linkBase?: string;
}) {
  const [items, setItems] = useState<ContactRow[]>(initial);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (companyId !== null) params.set("company_id", String(companyId));
      if (folderId !== null) params.set("folder_id", String(folderId));
      const res = await fetch(`/api/contacts?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { contacts?: ContactRow[] };
      if (Array.isArray(data.contacts)) setItems(data.contacts);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [companyId, folderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(() => {
    const lc = query.trim().toLowerCase();
    if (!lc) return items;
    return items.filter((c) => {
      const hay = [
        c.first_name,
        c.last_name,
        c.email,
        c.phone,
        c.title,
        c.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(lc);
    });
  }, [items, query]);

  async function softDelete(id: number) {
    if (
      !window.confirm(
        "Delete this contact? The contact and its projects move to Trash and can be restored from there.",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/contacts?id=${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setItems((prev) => prev.filter((c) => c.id !== id));
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
          placeholder="Search name, email, phone, title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-0 rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
        />
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
          + New contact
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-magic-ink/50 italic">
          {query
            ? `No matches for "${query}".`
            : "No contacts yet. Use + New contact to add the first person."}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border border-magic-border bg-white p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-magic-ink">
                    {linkBase && c.folder_id ? (
                      <Link
                        href={`${linkBase}/${c.folder_id}`}
                        className="hover:text-magic-red"
                      >
                        {displayName(c)}
                      </Link>
                    ) : (
                      <span>{displayName(c)}</span>
                    )}
                    {c.title && (
                      <span className="ml-2 text-xs text-magic-ink/50 font-normal">
                        · {c.title}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-magic-ink/60 mt-0.5">
                    {c.email && <>{c.email}</>}
                    {c.email && c.phone && <> · </>}
                    {c.phone && <>{c.phone}</>}
                  </div>
                  {linkBase && (c.project_count !== undefined || c.quotation_count !== undefined) && (
                    <div className="text-xs text-magic-ink/50 mt-1">
                      {(c.project_count ?? 0)} project
                      {(c.project_count ?? 0) === 1 ? "" : "s"} ·{" "}
                      {(c.quotation_count ?? 0)} quotation
                      {(c.quotation_count ?? 0) === 1 ? "" : "s"}
                    </div>
                  )}
                  {c.notes && (
                    <p className="text-xs text-magic-ink/70 mt-1 whitespace-pre-line line-clamp-2">
                      {c.notes}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {linkBase && c.folder_id && (
                    <Link
                      href={`${linkBase}/${c.folder_id}`}
                      className="px-2 py-1 text-xs font-semibold rounded border border-magic-border text-magic-ink/70 hover:bg-magic-soft transition-colors"
                    >
                      Open
                    </Link>
                  )}
                  <button
                    onClick={() => setEditing(c)}
                    disabled={busy}
                    className="px-2 py-1 text-xs font-medium rounded border border-magic-border text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => void softDelete(c.id)}
                    disabled={busy}
                    className="px-2 py-1 text-xs font-medium rounded border border-magic-border text-magic-ink/70 hover:bg-red-50 hover:text-red-700 hover:border-red-300 disabled:opacity-50 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <ContactModal
          mode={editing ? "edit" : "create"}
          initial={editing}
          companyId={companyId}
          folderId={folderId}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function ContactModal({
  mode,
  initial,
  companyId,
  folderId,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial: ContactRow | null;
  companyId: number | null;
  folderId: number | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [firstName, setFirstName] = useState(initial?.first_name ?? "");
  const [lastName, setLastName] = useState(initial?.last_name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!firstName.trim() && !lastName.trim() && !email.trim() && !phone.trim()) {
      setError("Provide at least one of first name, last name, email, phone.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        title: title.trim() || null,
        notes: notes.trim() || null,
      };
      const res =
        mode === "create"
          ? await fetch("/api/contacts", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                ...payload,
                company_id: companyId,
                folder_id: folderId,
              }),
            })
          : await fetch(`/api/contacts?id=${initial!.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await onSaved();
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
          <h3 className="font-semibold text-magic-ink">
            {mode === "create" ? "New contact" : `Edit contact`}
          </h3>
          <button
            onClick={onClose}
            className="text-magic-ink/50 hover:text-magic-ink"
          >
            ×
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            placeholder="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            disabled={busy}
            autoFocus
            className="rounded border border-magic-border bg-white px-3 py-1.5 text-sm"
          />
          <input
            type="text"
            placeholder="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            disabled={busy}
            className="rounded border border-magic-border bg-white px-3 py-1.5 text-sm"
          />
        </div>
        <input
          type="text"
          placeholder="Title (e.g. CTO)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
          className="w-full rounded border border-magic-border bg-white px-3 py-1.5 text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            className="rounded border border-magic-border bg-white px-3 py-1.5 text-sm"
          />
          <input
            type="tel"
            placeholder="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
            className="rounded border border-magic-border bg-white px-3 py-1.5 text-sm"
          />
        </div>
        <textarea
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
          rows={3}
          className="w-full rounded border border-magic-border bg-white px-3 py-1.5 text-sm"
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
            disabled={busy}
            className="rounded bg-magic-red text-white px-3 py-1.5 text-xs font-semibold hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
          >
            {busy
              ? mode === "create"
                ? "Creating…"
                : "Saving…"
              : mode === "create"
                ? "Create contact"
                : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
