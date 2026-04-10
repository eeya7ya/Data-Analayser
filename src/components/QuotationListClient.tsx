"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
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
  // Admin-only fields populated by a join on users.
  owner_username?: string | null;
  owner_display_name?: string | null;
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
}: {
  isAdmin: boolean;
}) {
  // ── Data loaded client-side so navigation to /quotation is instant ───
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
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
  }, []);

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

  // ── Folder CRUD state ────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
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

  // ── Folder CRUD handlers ─────────────────────────────────────────────
  async function createFolder() {
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create folder");
        return;
      }
      setFolders((prev) =>
        [...prev, data.folder].sort((a: Folder, b: Folder) =>
          a.name.localeCompare(b.name),
        ),
      );
      setExpanded((prev) => new Set(prev).add(String(data.folder.id)));
      setNewName("");
      setShowCreate(false);
    } finally {
      setCreating(false);
    }
  }

  async function renameFolder(id: number) {
    if (!editName.trim()) return;
    setRenaming(true);
    setError("");
    try {
      const res = await fetch(`/api/folders?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to rename folder");
        return;
      }
      setFolders((prev) =>
        prev
          .map((f) => (f.id === id ? data.folder : f))
          .sort((a: Folder, b: Folder) => a.name.localeCompare(b.name)),
      );
      setEditingId(null);
      setEditName("");
    } finally {
      setRenaming(false);
    }
  }

  async function deleteFolder(id: number) {
    if (!confirm("Delete this folder? Quotations inside will become Unfiled."))
      return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/folders?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setFolders((prev) => prev.filter((f) => f.id !== id));
        window.location.reload();
      }
    } finally {
      setDeletingId(null);
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
          New Folder
        </button>
      </div>

      {/* Create folder form */}
      {showCreate && (
        <div className="mb-4 p-3 rounded-xl border border-magic-border bg-white flex items-center gap-2">
          <svg
            className="w-5 h-5 text-magic-ink/40 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
            />
          </svg>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createFolder()}
            placeholder="Folder name…"
            autoFocus
            className="flex-1 px-3 py-1.5 text-sm border border-magic-border rounded-lg focus:outline-none focus:ring-2 focus:ring-magic-red/30"
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
              setError("");
            }}
            className="px-3 py-1.5 text-sm text-magic-ink/60 hover:text-magic-ink transition-colors"
          >
            Cancel
          </button>
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
          No quotations yet. Go to{" "}
          <a href="/designer" className="text-magic-red underline">
            the Designer
          </a>{" "}
          to create one.
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

                {/* Name (or rename input) */}
                {isEditing && !isUnfiled ? (
                  <div
                    className="flex items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") renameFolder(g.folderId!);
                        if (e.key === "Escape") {
                          setEditingId(null);
                          setEditName("");
                          setError("");
                        }
                      }}
                      autoFocus
                      className="px-2 py-1 text-sm border border-magic-border rounded focus:outline-none focus:ring-2 focus:ring-magic-red/30"
                    />
                    <button
                      onClick={() => renameFolder(g.folderId!)}
                      disabled={renaming || !editName.trim()}
                      className="text-xs font-medium text-green-600 hover:underline disabled:opacity-50"
                    >
                      {renaming ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(null);
                        setEditName("");
                        setError("");
                      }}
                      className="text-xs text-magic-ink/50 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <span className="font-semibold text-magic-ink">
                    {isUnfiled ? "Unfiled" : g.folder!.name}
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
                )}

                {/* Count */}
                <span className="text-xs text-magic-ink/50">
                  ({g.items.length} quotation
                  {g.items.length !== 1 ? "s" : ""})
                </span>

                {/* Folder dates (named folders only) */}
                {!isUnfiled && g.folder && !isEditing && (
                  <span className="hidden sm:inline text-xs text-magic-ink/40 ml-2">
                    Created {new Date(g.folder.created_at).toLocaleDateString()}
                  </span>
                )}

                {/* Spacer */}
                <div className="flex-1" />

                {/* Actions (named folders only) */}
                {!isUnfiled && !isEditing && (
                  <div
                    className="flex items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => {
                        setEditingId(g.folderId);
                        setEditName(g.folder!.name);
                        setError("");
                      }}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Rename
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => deleteFolder(g.folderId!)}
                        disabled={deletingId === g.folderId}
                        className="text-xs text-red-500 hover:underline disabled:opacity-50"
                      >
                        {deletingId === g.folderId ? "Deleting…" : "Delete"}
                      </button>
                    )}
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
                              className="border-t border-magic-border hover:bg-magic-soft/10"
                            >
                              <td className="p-3 font-mono">
                                <Link
                                  href={`/quotation?id=${r.id}`}
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
                              <td className="p-3 text-right">
                                <MoveToFolder
                                  quotationId={r.id}
                                  currentFolderId={r.folder_id}
                                  folders={foldersForMove}
                                />
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
