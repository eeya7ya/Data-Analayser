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
  created_at: string;
  updated_at: string;
}

interface Folder {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
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
  quotations,
  folders: initialFolders,
  isAdmin,
}: {
  quotations: Quotation[];
  folders: Folder[];
  isAdmin: boolean;
}) {
  // ── Search ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // ── Folders (mutable for create / rename / delete) ────────────────────
  const [folders, setFolders] = useState(initialFolders);

  // ── Expand / collapse ────────────────────────────────────────────────
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const f of initialFolders) s.add(String(f.id));
    s.add("unfiled");
    return s;
  });

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
    const grouped = new Map<number | null, Quotation[]>();
    for (const r of filtered) {
      const key = r.folder_id;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(r);
    }

    const result: {
      key: string;
      folderId: number | null;
      folder: Folder | null;
      items: Quotation[];
    }[] = [];

    // Named folders (alphabetical)
    for (const f of folders) {
      const items = grouped.get(f.id) || [];
      if (isSearching && items.length === 0) continue; // hide empty during search
      result.push({ key: String(f.id), folderId: f.id, folder: f, items });
    }

    // Unfiled
    const unfiled = grouped.get(null) || [];
    if (!isSearching || unfiled.length > 0) {
      result.push({
        key: "unfiled",
        folderId: null,
        folder: null,
        items: unfiled,
      });
    }

    return result;
  }, [filtered, folders, isSearching]);

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
      {isSearching && (
        <div className="mb-3 text-sm text-magic-ink/50">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""} for &ldquo;
          {debouncedSearch}&rdquo;
        </div>
      )}

      {/* Folder sections */}
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

      {/* No results for search */}
      {isSearching && filtered.length === 0 && (
        <div className="rounded-2xl border border-magic-border bg-white p-6 text-center text-magic-ink/50 mt-3">
          No quotations match your search.
        </div>
      )}
    </div>
  );
}
