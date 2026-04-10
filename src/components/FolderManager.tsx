"use client";

import { useState } from "react";

interface Folder {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export default function FolderManager({
  folders: initialFolders,
  isAdmin,
}: {
  folders: Folder[];
  isAdmin: boolean;
}) {
  const [folders, setFolders] = useState(initialFolders);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

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
        [...prev, data.folder].sort((a, b) => a.name.localeCompare(b.name))
      );
      setNewName("");
      setShowCreate(false);
      window.location.reload();
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
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setEditingId(null);
      setEditName("");
      window.location.reload();
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

  return (
    <div className="rounded-2xl border border-magic-border bg-white overflow-hidden mb-4">
      <div className="p-3 bg-magic-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-magic-ink/60"
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
          <h2 className="font-semibold text-magic-ink">Manage Folders</h2>
          <span className="text-xs text-magic-ink/50">
            ({folders.length} folder{folders.length !== 1 ? "s" : ""})
          </span>
        </div>
        <button
          onClick={() => {
            setShowCreate(!showCreate);
            setError("");
          }}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-magic-red text-white hover:bg-magic-red/90 transition-colors"
        >
          <svg
            className="w-3.5 h-3.5"
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
        <div className="p-3 border-b border-magic-border bg-magic-soft/30 flex items-center gap-2">
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
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
          >
            {creating ? "Creating…" : "Create"}
          </button>
          <button
            onClick={() => {
              setShowCreate(false);
              setNewName("");
              setError("");
            }}
            className="px-3 py-1.5 text-xs text-magic-ink/60 hover:text-magic-ink transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <div className="px-3 py-2 text-xs text-red-600 bg-red-50 border-b border-magic-border">
          {error}
        </div>
      )}

      {/* Folder list */}
      {folders.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-xs text-magic-ink/50 uppercase bg-magic-soft/20">
            <tr>
              <th className="p-2 pl-3 text-left">Folder Name</th>
              <th className="p-2 text-left">Created</th>
              <th className="p-2 text-left">Last Modified</th>
              <th className="p-2 pr-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {folders.map((f) => (
              <tr
                key={f.id}
                className="border-t border-magic-border hover:bg-magic-soft/10"
              >
                <td className="p-2 pl-3">
                  {editingId === f.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && renameFolder(f.id)
                        }
                        autoFocus
                        className="flex-1 px-2 py-1 text-sm border border-magic-border rounded focus:outline-none focus:ring-2 focus:ring-magic-red/30"
                      />
                      <button
                        onClick={() => renameFolder(f.id)}
                        disabled={renaming || !editName.trim()}
                        className="text-xs text-green-600 hover:underline disabled:opacity-50"
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
                    <div className="flex items-center gap-2">
                      <svg
                        className="w-4 h-4 text-magic-ink/40"
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
                      <span className="font-medium">{f.name}</span>
                    </div>
                  )}
                </td>
                <td className="p-2 text-xs text-magic-ink/60">
                  {new Date(f.created_at).toLocaleString()}
                </td>
                <td className="p-2 text-xs text-magic-ink/60">
                  {new Date(f.updated_at).toLocaleString()}
                </td>
                <td className="p-2 pr-3 text-right">
                  {editingId !== f.id && (
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setEditingId(f.id);
                          setEditName(f.name);
                          setError("");
                        }}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Rename
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => deleteFolder(f.id)}
                          disabled={deletingId === f.id}
                          className="text-xs text-red-500 hover:underline disabled:opacity-50"
                        >
                          {deletingId === f.id ? "Deleting…" : "Delete"}
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
