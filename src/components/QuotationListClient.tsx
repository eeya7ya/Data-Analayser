"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import MoveToFolder from "@/components/MoveToFolder";

interface Quotation {
  id: number;
  ref: string;
  project_name: string;
  client_name: string | null;
  site_name: string;
  folder_id: number | null;
  owner_id?: number | null;
  created_at: string;
  updated_at: string;
  // Admin-only fields populated by a join on users.
  owner_username?: string | null;
  owner_display_name?: string | null;
}

interface Folder {
  id: number;
  name: string;
  owner_id?: number | null;
  created_at: string;
  updated_at: string;
  // CRM fields (a folder is a client record).
  client_email?: string | null;
  client_phone?: string | null;
  client_company?: string | null;
  // Admin-only fields populated by a join on users.
  owner_username?: string | null;
  owner_display_name?: string | null;
}

/**
 * Folders created before the "name required" validation could slip into the
 * database with an empty or whitespace-only name. When that happens the
 * folder bar ends up rendering just an owner badge with no visible label,
 * which is extremely confusing — the user thinks a quotation count of 0
 * means their data is gone when really the row just has no title. This
 * helper keeps the list readable by always showing *something*.
 */
function folderDisplayName(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  return trimmed || "(untitled client)";
}

function formatDateTime(dt: string) {
  const d = new Date(dt);
  const date = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return { date, time };
}

export default function QuotationListClient({
  isAdmin,
  initialQuotations,
  initialFolders,
}: {
  isAdmin: boolean;
  /**
   * Server-rendered initial data. When provided, the component mounts with
   * the real rows already in state and skips the initial `/api/quotations`
   * + `/api/folders` round-trip entirely — killing the skeleton flash on
   * cold starts.
   */
  initialQuotations?: Array<Record<string, unknown>>;
  initialFolders?: Array<Record<string, unknown>>;
}) {
  const router = useRouter();

  // ── Data loaded client-side (or hydrated from the server page) ───
  const hasInitial =
    Array.isArray(initialQuotations) && Array.isArray(initialFolders);
  const [quotations, setQuotations] = useState<Quotation[]>(
    () => (initialQuotations as Quotation[] | undefined) || [],
  );
  const [folders, setFolders] = useState<Folder[]>(
    () => (initialFolders as Folder[] | undefined) || [],
  );
  const [dataLoading, setDataLoading] = useState(!hasInitial);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    // The server page already handed us the full dataset on first paint.
    // Skip the client fetch entirely.
    if (hasInitial) return;
    let cancelled = false;
    setDataLoading(true);
    setLoadError(null);
    Promise.all([
      fetch("/api/quotations").then((r) => r.json()),
      fetch("/api/folders").then((r) => r.json()),
    ])
      .then(([qRes, fRes]) => {
        if (cancelled) return;
        setQuotations((qRes.quotations || []) as Quotation[]);
        setFolders((fRes.folders || []) as Folder[]);
      })
      .catch((err) => {
        if (!cancelled) setLoadError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setDataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasInitial]);

  // ── Search ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // ── Expand / collapse ────────────────────────────────────────────────
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    s.add("unfiled");
    return s;
  });
  useEffect(() => {
    // Auto-expand every folder once data arrives.
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const f of folders) next.add(String(f.id));
      return next;
    });
  }, [folders]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ── Client-folder CRUD state (folder == client record) ──────────────
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deletingQuotationId, setDeletingQuotationId] = useState<number | null>(null);
  const [error, setError] = useState("");

  // ── Filtering + grouping (recomputed on search / folder changes) ────
  const isSearching = debouncedSearch.length > 0;

  const filtered = useMemo(() => {
    if (!isSearching) return quotations;
    const q = debouncedSearch.toLowerCase();
    return quotations.filter(
      (r) =>
        r.ref.toLowerCase().includes(q) ||
        r.project_name.toLowerCase().includes(q) ||
        (r.client_name && r.client_name.toLowerCase().includes(q)) ||
        r.site_name.toLowerCase().includes(q),
    );
  }, [quotations, debouncedSearch, isSearching]);

  const groups = useMemo(() => {
    // Bucket quotations by folder id.
    const byFolder = new Map<number | null, Quotation[]>();
    for (const r of filtered) {
      const key = r.folder_id;
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key)!.push(r);
    }

    const result: {
      key: string;
      folderId: number | null;
      folder: Folder | null;
      items: Quotation[];
      unfiledOwnerLabel?: string | null;
    }[] = [];

    // Named folders — already sorted server-side.
    for (const f of folders) {
      const items = byFolder.get(f.id) || [];
      if (isSearching && items.length === 0) continue;
      result.push({ key: String(f.id), folderId: f.id, folder: f, items });
    }

    // Unfiled section.
    const unfiled = byFolder.get(null) || [];
    if (!isAdmin) {
      // Regular users see a single flat "Unfiled" bucket.
      if (!isSearching || unfiled.length > 0) {
        result.push({
          key: "unfiled",
          folderId: null,
          folder: null,
          items: unfiled,
        });
      }
    } else {
      // Admin: one unfiled bucket per owning user so the UI stays readable
      // across the whole org.
      const perOwner = new Map<number | null, Quotation[]>();
      for (const r of unfiled) {
        const ownerKey = r.owner_id ?? null;
        if (!perOwner.has(ownerKey)) perOwner.set(ownerKey, []);
        perOwner.get(ownerKey)!.push(r);
      }
      const sortedOwners = [...perOwner.entries()].sort(([aKey, aArr], [bKey, bArr]) => {
        const aLabel =
          aArr[0]?.owner_display_name?.trim() ||
          aArr[0]?.owner_username ||
          (aKey === null ? "—" : `user#${aKey}`);
        const bLabel =
          bArr[0]?.owner_display_name?.trim() ||
          bArr[0]?.owner_username ||
          (bKey === null ? "—" : `user#${bKey}`);
        return aLabel.localeCompare(bLabel);
      });
      for (const [ownerKey, items] of sortedOwners) {
        if (isSearching && items.length === 0) continue;
        const label =
          items[0]?.owner_display_name?.trim() ||
          items[0]?.owner_username ||
          null;
        result.push({
          key: `unfiled-${ownerKey ?? "null"}`,
          folderId: null,
          folder: null,
          items,
          unfiledOwnerLabel: label,
        });
      }
      // Make sure the section shows up (even if empty) for the current admin
      // when there are no unfiled items at all — preserves the old behaviour.
      if (!isSearching && sortedOwners.length === 0) {
        result.push({
          key: "unfiled",
          folderId: null,
          folder: null,
          items: [],
        });
      }
    }

    return result;
  }, [filtered, folders, isSearching, isAdmin]);

  const foldersForMove = useMemo(
    () => folders.map((f) => ({ id: f.id, name: f.name })),
    [folders],
  );

  // Client-side folder sort that mirrors the admin server query
  // (`order by u.username nulls first, f.name asc`). Regular users get the
  // simpler name-only sort. Without this, optimistic updates after create /
  // edit would fall back to plain `name.localeCompare`, jumbling a
  // multi-user admin list where folders from different owners share a name
  // (or have empty names, which sort identically).
  function sortFolders(list: Folder[]): Folder[] {
    return [...list].sort((a, b) => {
      if (isAdmin) {
        const au = (a.owner_username || "").toLowerCase();
        const bu = (b.owner_username || "").toLowerCase();
        if (au !== bu) {
          if (!au) return -1;
          if (!bu) return 1;
          return au.localeCompare(bu);
        }
      }
      return (a.name || "").localeCompare(b.name || "");
    });
  }

  // ── Client/folder CRUD handlers ──────────────────────────────────────
  async function createFolder() {
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          client_email: newEmail.trim() || null,
          client_phone: newPhone.trim() || null,
          client_company: newCompany.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create client");
        return;
      }
      setFolders((prev) => sortFolders([...prev, data.folder]));
      setExpanded((prev) => new Set(prev).add(String(data.folder.id)));
      setNewName("");
      setNewEmail("");
      setNewPhone("");
      setNewCompany("");
      setShowCreate(false);
    } finally {
      setCreating(false);
    }
  }

  /** Save CRM edits (name + email/phone/company) for an existing client. */
  async function saveFolderEdit(id: number) {
    if (!editName.trim()) return;
    setRenaming(true);
    setError("");
    try {
      const res = await fetch(`/api/folders?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          client_email: editEmail.trim() || null,
          client_phone: editPhone.trim() || null,
          client_company: editCompany.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update client");
        return;
      }
      setFolders((prev) =>
        sortFolders(prev.map((f) => (f.id === id ? data.folder : f))),
      );
      setEditingId(null);
      setEditName("");
      setEditEmail("");
      setEditPhone("");
      setEditCompany("");
    } finally {
      setRenaming(false);
    }
  }

  async function deleteFolder(id: number) {
    if (
      !confirm(
        "Move this client and all of its quotations to the Trash? They can be restored from the Trash tab later.",
      )
    )
      return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/folders?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setFolders((prev) => prev.filter((f) => f.id !== id));
        // The server cascade-soft-deleted the folder's quotations too; drop
        // them from local state so the UI updates without a reload.
        setQuotations((prev) => prev.filter((r) => r.folder_id !== id));
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to move client to trash");
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function deleteQuotation(id: number) {
    if (!confirm("Move this quotation to the Trash? It can be restored later."))
      return;
    setDeletingQuotationId(id);
    try {
      const res = await fetch(`/api/quotations?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setQuotations((prev) => prev.filter((r) => r.id !== id));
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to move quotation to trash");
      }
    } finally {
      setDeletingQuotationId(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Top bar: search + new folder */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-magic-ink/40"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ref, project, client, or site…"
            className="w-full pl-10 pr-4 py-2 text-sm border border-magic-border rounded-xl focus:outline-none focus:ring-2 focus:ring-magic-red/30 bg-white"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-magic-ink/40 hover:text-magic-ink"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
        <button
          onClick={() => {
            setShowCreate(!showCreate);
            setError("");
          }}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl bg-magic-red text-white hover:bg-magic-red/90 transition-colors whitespace-nowrap"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4v16m8-8H4"
            />
          </svg>
          New Client
        </button>
      </div>

      {/* Create client form — a client is a folder with CRM fields */}
      {showCreate && (
        <div className="mb-4 p-3 rounded-xl border border-magic-border bg-white">
          <div className="flex flex-wrap items-start gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createFolder()}
              placeholder="Client name *"
              autoFocus
              className="flex-1 min-w-[180px] px-3 py-1.5 text-sm border border-magic-border rounded-lg focus:outline-none focus:ring-2 focus:ring-magic-red/30"
            />
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Email"
              className="flex-1 min-w-[180px] px-3 py-1.5 text-sm border border-magic-border rounded-lg focus:outline-none focus:ring-2 focus:ring-magic-red/30"
            />
            <input
              type="tel"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="Phone"
              className="flex-1 min-w-[150px] px-3 py-1.5 text-sm border border-magic-border rounded-lg focus:outline-none focus:ring-2 focus:ring-magic-red/30"
            />
            <input
              type="text"
              value={newCompany}
              onChange={(e) => setNewCompany(e.target.value)}
              placeholder="Company"
              className="flex-1 min-w-[180px] px-3 py-1.5 text-sm border border-magic-border rounded-lg focus:outline-none focus:ring-2 focus:ring-magic-red/30"
            />
            <button
              onClick={createFolder}
              disabled={creating || !newName.trim()}
              className="px-4 py-1.5 text-sm font-medium rounded-lg bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
            >
              {creating ? "Creating…" : "Create"}
            </button>
            <button
              onClick={() => {
                setShowCreate(false);
                setNewName("");
                setNewEmail("");
                setNewPhone("");
                setNewCompany("");
                setError("");
              }}
              className="px-3 py-1.5 text-sm text-magic-ink/60 hover:text-magic-ink transition-colors"
            >
              Cancel
            </button>
          </div>
          <p className="mt-2 text-[11px] text-magic-ink/50">
            Clients are reused across quotations — typing their info once here means it auto-fills on every future quotation you create for them.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-2 text-sm text-red-600 bg-red-50 rounded-xl border border-red-200">
          {error}
        </div>
      )}

      {/* Search results summary */}
      {isSearching && !dataLoading && (
        <div className="mb-3 text-sm text-magic-ink/50">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""} for &ldquo;
          {debouncedSearch}&rdquo;
        </div>
      )}

      {loadError && (
        <div className="mb-4 px-4 py-3 text-sm text-red-600 bg-red-50 rounded-xl border border-red-200">
          Failed to load quotations: {loadError}
        </div>
      )}

      {/* Loading skeleton */}
      {dataLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-14 rounded-2xl border border-magic-border bg-white animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!dataLoading && !loadError && quotations.length === 0 && (
        <div className="rounded-2xl border border-magic-border bg-white p-6 text-center text-magic-ink/50">
          <div>
            No quotations yet. Go to{" "}
            <a href="/designer" className="text-magic-red underline">
              the Designer
            </a>{" "}
            to create one.
          </div>
          <div className="mt-2 text-xs">
            Missing a quotation you know you saved? Check the{" "}
            <strong className="text-magic-red">Trash</strong> tab above —
            deleted folders and their quotations can be restored from there.
          </div>
        </div>
      )}

      {/* Folder sections */}
      {!dataLoading && quotations.length > 0 && (
      <div className="space-y-3">
        {groups.map((g) => {
          const isExpanded =
            isSearching && g.items.length > 0
              ? true
              : expanded.has(g.key);
          const isUnfiled = g.folderId === null;
          const isEditing = editingId === g.folderId;

          return (
            <div
              key={g.key}
              className="rounded-2xl border border-magic-border bg-white overflow-hidden"
            >
              {/* Folder header */}
              <div
                onClick={() => toggle(g.key)}
                className="p-3 bg-magic-header flex items-center gap-2 cursor-pointer select-none hover:bg-magic-header/80 transition-colors"
              >
                {/* Chevron */}
                <svg
                  className={`w-4 h-4 text-magic-ink/40 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 5l7 7-7 7"
                  />
                </svg>

                {/* Folder icon */}
                <svg
                  className="w-5 h-5 text-magic-ink/50"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>

                {/* Name + CRM info (or edit form) */}
                {isEditing && !isUnfiled ? (
                  <div
                    className="flex flex-wrap items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveFolderEdit(g.folderId!);
                        if (e.key === "Escape") {
                          setEditingId(null);
                          setEditName("");
                          setError("");
                        }
                      }}
                      autoFocus
                      placeholder="Client name *"
                      className="px-2 py-1 text-sm border border-magic-border rounded focus:outline-none focus:ring-2 focus:ring-magic-red/30"
                    />
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      placeholder="Email"
                      className="px-2 py-1 text-sm border border-magic-border rounded focus:outline-none focus:ring-2 focus:ring-magic-red/30"
                    />
                    <input
                      type="tel"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      placeholder="Phone"
                      className="px-2 py-1 text-sm border border-magic-border rounded focus:outline-none focus:ring-2 focus:ring-magic-red/30"
                    />
                    <input
                      type="text"
                      value={editCompany}
                      onChange={(e) => setEditCompany(e.target.value)}
                      placeholder="Company"
                      className="px-2 py-1 text-sm border border-magic-border rounded focus:outline-none focus:ring-2 focus:ring-magic-red/30"
                    />
                    <button
                      onClick={() => saveFolderEdit(g.folderId!)}
                      disabled={renaming || !editName.trim()}
                      className="text-xs font-medium text-green-600 hover:underline disabled:opacity-50"
                    >
                      {renaming ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(null);
                        setEditName("");
                        setEditEmail("");
                        setEditPhone("");
                        setEditCompany("");
                        setError("");
                      }}
                      className="text-xs text-magic-ink/50 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5">
                    <span
                      className={`font-semibold ${
                        !isUnfiled && !g.folder!.name?.trim()
                          ? "text-magic-ink/40 italic"
                          : "text-magic-ink"
                      }`}
                    >
                      {isUnfiled ? "Unfiled" : folderDisplayName(g.folder!.name)}
                      {isAdmin && !isUnfiled && g.folder?.owner_username && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-magic-red/10 text-magic-red text-[10px] font-semibold px-2 py-0.5 uppercase tracking-wide">
                          @{g.folder.owner_display_name?.trim() || g.folder.owner_username}
                        </span>
                      )}
                      {isAdmin && isUnfiled && g.unfiledOwnerLabel && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-magic-red/10 text-magic-red text-[10px] font-semibold px-2 py-0.5 uppercase tracking-wide">
                          @{g.unfiledOwnerLabel}
                        </span>
                      )}
                    </span>
                    {/* Count */}
                    <span className="text-xs text-magic-ink/50">
                      ({g.items.length} quotation
                      {g.items.length !== 1 ? "s" : ""})
                    </span>
                    {/* CRM summary (named folders only) */}
                    {!isUnfiled && g.folder && (
                      <span className="hidden md:inline text-[11px] text-magic-ink/60">
                        {g.folder.client_email && (
                          <span className="mr-3">{g.folder.client_email}</span>
                        )}
                        {g.folder.client_phone && (
                          <span className="mr-3">{g.folder.client_phone}</span>
                        )}
                        {g.folder.client_company && (
                          <span className="mr-3 italic">{g.folder.client_company}</span>
                        )}
                      </span>
                    )}
                  </div>
                )}

                {/* Spacer */}
                <div className="flex-1" />

                {/* Actions (named folders only) */}
                {!isUnfiled && !isEditing && (
                  <div
                    className="flex items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Link
                      href={`/designer?folder=${g.folderId}`}
                      className="text-xs font-medium text-magic-red hover:underline"
                    >
                      + New quotation
                    </Link>
                    <button
                      onClick={() => {
                        setEditingId(g.folderId);
                        setEditName(g.folder!.name);
                        setEditEmail(g.folder!.client_email || "");
                        setEditPhone(g.folder!.client_phone || "");
                        setEditCompany(g.folder!.client_company || "");
                        setError("");
                      }}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteFolder(g.folderId!)}
                      disabled={deletingId === g.folderId}
                      className="text-xs text-red-500 hover:underline disabled:opacity-50"
                    >
                      {deletingId === g.folderId ? "Moving…" : "Trash"}
                    </button>
                  </div>
                )}
              </div>

              {/* Quotation table (when expanded) */}
              {isExpanded && (
                <>
                  {g.items.length === 0 ? (
                    <div className="p-4 text-sm text-magic-ink/40 text-center">
                      No quotations in this folder.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="text-magic-red text-xs uppercase bg-magic-soft/20">
                        <tr>
                          <th className="p-3 text-left">Ref</th>
                          <th className="p-3 text-left">Project</th>
                          <th className="p-3 text-left">Client</th>
                          <th className="p-3 text-left">Site</th>
                          <th className="p-3 text-left">Created</th>
                          <th className="p-3 text-left">Last Edited</th>
                          <th className="p-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((r) => {
                          const created = formatDateTime(r.created_at);
                          const updated = formatDateTime(r.updated_at);
                          const wasEdited = r.updated_at !== r.created_at;
                          return (
                            <tr
                              key={r.id}
                              onClick={() =>
                                router.push(`/quotation?id=${r.id}`)
                              }
                              className="border-t border-magic-border hover:bg-magic-soft/10 cursor-pointer"
                            >
                              <td className="p-3 font-mono">
                                <Link
                                  href={`/quotation?id=${r.id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-magic-red hover:underline"
                                >
                                  {r.ref}
                                </Link>
                              </td>
                              <td className="p-3">{r.project_name}</td>
                              <td className="p-3">
                                {r.client_name || "—"}
                              </td>
                              <td className="p-3">{r.site_name}</td>
                              <td className="p-3 text-xs text-magic-ink/60">
                                <div>{created.date}</div>
                                <div className="text-magic-ink/40">
                                  {created.time}
                                </div>
                              </td>
                              <td className="p-3 text-xs text-magic-ink/60">
                                {wasEdited ? (
                                  <>
                                    <div>{updated.date}</div>
                                    <div className="text-magic-ink/40">
                                      {updated.time}
                                    </div>
                                  </>
                                ) : (
                                  <span className="text-magic-ink/30">
                                    —
                                  </span>
                                )}
                              </td>
                              <td
                                className="p-3 text-right"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-end gap-3">
                                  <MoveToFolder
                                    quotationId={r.id}
                                    currentFolderId={r.folder_id}
                                    folders={foldersForMove}
                                  />
                                  <button
                                    onClick={() => deleteQuotation(r.id)}
                                    disabled={deletingQuotationId === r.id}
                                    title="Move to trash"
                                    className="text-xs text-red-500 hover:underline disabled:opacity-50"
                                  >
                                    {deletingQuotationId === r.id
                                      ? "Moving…"
                                      : "Trash"}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      )}

      {/* No results for search */}
      {!dataLoading && isSearching && filtered.length === 0 && (
        <div className="rounded-2xl border border-magic-border bg-white p-6 text-center text-magic-ink/50 mt-3">
          No quotations match your search.
        </div>
      )}
    </div>
  );
}
