"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EditFolderDialog } from "@/components/EditFolderDialog";
import { useNameConflicts } from "@/components/useNameConflicts";

/**
 * Reusable client (folder) list with search + "+ New client".
 * Powers two pages:
 *   • /crm/company/[companyId]   — clients inside one company.
 *     `parentLinkBase` = "/crm/company/<id>/clients" and `newClient`
 *     POSTs with kind=company + company_id.
 *   • /crm/individual            — individual-kind folders, no parent.
 *     `parentLinkBase` = "/crm/individual" and `newClient` POSTs with
 *     kind=individual + company_id=null.
 *
 * Both flavours read /api/folders, filter client-side by `q`, and
 * splice newly created folders into local state so the UI updates
 * without a full reload.
 */

export interface ClientFolderRow {
  id: number;
  name: string;
  kind: "company" | "individual" | null;
  company_id: number | null;
  client_email: string | null;
  client_phone: string | null;
  client_company: string | null;
  owner_username: string | null;
  project_count: number;
  quotation_count: number;
  latest_quotation_at: string | null;
}

export default function ClientListClient({
  initial,
  newClientKind,
  companyId,
  linkBase,
  newLabel,
  searchPlaceholder,
  emptyHint,
}: {
  initial: ClientFolderRow[];
  newClientKind: "company" | "individual";
  companyId: number | null;
  linkBase: string;
  newLabel: string;
  searchPlaceholder: string;
  emptyHint: string;
}) {
  const [items, setItems] = useState<ClientFolderRow[]>(initial);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ClientFolderRow | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      // We re-pull from /api/folders so the counts stay accurate
      // after creating something. Search is still client-side.
      const params = new URLSearchParams();
      if (companyId !== null) params.set("company_id", String(companyId));
      else if (newClientKind === "individual") params.set("kind", "individual");
      const res = await fetch(`/api/folders?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { folders?: ClientFolderRow[] };
      if (Array.isArray(data.folders)) setItems(data.folders);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [companyId, newClientKind]);

  const visible = useMemo(() => {
    const lc = query.trim().toLowerCase();
    if (!lc) return items;
    return items.filter((f) => {
      const hay = [
        f.name,
        f.client_email,
        f.client_phone,
        f.client_company,
        f.owner_username,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(lc);
    });
  }, [items, query]);

  useEffect(() => {
    // First mount uses `initial`; this keeps it fresh if the user
    // navigates back to the page after creating elsewhere.
    void refresh();
  }, [refresh]);

  async function archive(id: number) {
    if (
      !window.confirm(
        "Archive this client? It moves to Trash and can be restored from there.",
      )
    )
      return;
    setBusy(true);
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-0 rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
        />
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-magic-red text-white px-3 py-2 text-sm font-semibold hover:bg-magic-red/90 transition-colors"
        >
          {newLabel}
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
            {query ? `No matches for "${query}".` : emptyHint}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((f) => (
            <li
              key={f.id}
              className="rounded-xl border border-magic-border bg-white p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <Link
                    href={`${linkBase}/${f.id}`}
                    className="font-semibold text-magic-ink hover:text-magic-red"
                  >
                    {f.name}
                  </Link>
                  <div className="text-xs text-magic-ink/60 mt-0.5">
                    {f.client_email && <>{f.client_email} · </>}
                    {f.client_phone && <>{f.client_phone} · </>}
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
                    href={`${linkBase}/${f.id}`}
                    className="rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft transition-colors"
                  >
                    Open
                  </Link>
                  <button
                    onClick={() => setEditing(f)}
                    disabled={busy}
                    className="px-2 py-1.5 text-xs font-medium rounded border border-magic-border text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => void archive(f.id)}
                    disabled={busy}
                    className="px-2 py-1.5 text-xs font-medium rounded border border-magic-border text-magic-ink/70 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300 disabled:opacity-50 transition-colors"
                  >
                    Archive
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <NewClientModal
          kind={newClientKind}
          companyId={companyId}
          onClose={() => setCreating(false)}
          onCreated={(row) => {
            setItems((prev) => [row, ...prev]);
            setCreating(false);
          }}
        />
      )}

      {editing && (
        <EditFolderDialog
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(row) => {
            setItems((prev) =>
              prev.map((f) => (f.id === row.id ? { ...f, ...row } : f)),
            );
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function NewClientModal({
  kind,
  companyId,
  onClose,
  onCreated,
}: {
  kind: "company" | "individual";
  companyId: number | null;
  onClose: () => void;
  onCreated: (row: ClientFolderRow) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only individual clients are subject to the cross-kind block; company
  // contacts may legitimately repeat a person's name across companies.
  const rawConflicts = useNameConflicts(name, "individual");
  const conflicts = kind === "individual" ? rawConflicts : [];

  async function submit() {
    if (!name.trim() || conflicts.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          client_email: email.trim() || null,
          client_phone: phone.trim() || null,
          kind,
          company_id: kind === "company" ? companyId : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // The folders POST returns a partial row; pad it with zero
      // counts so the list renders cleanly until the next refresh.
      onCreated({
        id: data.folder.id,
        name: data.folder.name,
        kind: data.folder.kind ?? kind,
        company_id: data.folder.company_id ?? companyId,
        client_email: data.folder.client_email ?? null,
        client_phone: data.folder.client_phone ?? null,
        client_company: data.folder.client_company ?? null,
        owner_username: null,
        project_count: 0,
        quotation_count: 0,
        latest_quotation_at: null,
      });
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
            {kind === "company" ? "New client at this company" : "New individual client"}
          </h3>
          <button
            onClick={onClose}
            className="text-magic-ink/50 hover:text-magic-ink"
          >
            ×
          </button>
        </div>
        <input
          type="text"
          placeholder={kind === "company" ? "Contact name (required)" : "Client name (required)"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          autoFocus
          className="w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
        />
        {conflicts.length > 0 && (
          <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
            “{conflicts[0].name}” already exists as a company. A name can’t be
            both an individual and a company — rename one to continue.
          </p>
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          className="w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
        />
        <input
          type="tel"
          placeholder="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={busy}
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
            {busy ? "Creating…" : "Create client"}
          </button>
        </div>
      </div>
    </div>
  );
}
