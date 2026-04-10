"use client";

import { useState, useRef, useEffect } from "react";

interface Folder {
  id: number;
  name: string;
}

export default function MoveToFolder({
  quotationId,
  currentFolderId,
  folders,
}: {
  quotationId: number;
  currentFolderId: number | null;
  folders: Folder[];
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderLoading, setNewFolderLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreatingNew(false);
        setNewFolderName("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (creatingNew && inputRef.current) {
      inputRef.current.focus();
    }
  }, [creatingNew]);

  async function moveTo(folderId: number | null) {
    if (folderId === currentFolderId) {
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/quotations?id=${quotationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: folderId }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } finally {
      setLoading(false);
      setOpen(false);
    }
  }

  async function createAndMove() {
    if (!newFolderName.trim()) return;
    setNewFolderLoading(true);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.folder) {
        await moveTo(data.folder.id);
      }
    } finally {
      setNewFolderLoading(false);
      setCreatingNew(false);
      setNewFolderName("");
    }
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        className="text-blue-600 text-xs hover:underline disabled:opacity-50"
        title="Move to folder"
      >
        {loading ? "Moving…" : "Move"}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 rounded-md border border-magic-border bg-white shadow-lg py-1 text-sm max-h-72 overflow-y-auto">
          <button
            onClick={() => moveTo(null)}
            className={`w-full text-left px-3 py-1.5 hover:bg-magic-header ${
              currentFolderId === null ? "font-semibold text-magic-red" : ""
            }`}
          >
            Unfiled
          </button>
          <div className="border-t border-magic-border my-1" />
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => moveTo(f.id)}
              className={`w-full text-left px-3 py-1.5 hover:bg-magic-header ${
                currentFolderId === f.id ? "font-semibold text-magic-red" : ""
              }`}
            >
              {f.name}
            </button>
          ))}
          <div className="border-t border-magic-border my-1" />
          {creatingNew ? (
            <div className="px-2 py-1.5 flex items-center gap-1">
              <input
                ref={inputRef}
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createAndMove()}
                placeholder="Folder name…"
                className="flex-1 px-2 py-1 text-xs border border-magic-border rounded focus:outline-none focus:ring-1 focus:ring-magic-red/30"
              />
              <button
                onClick={createAndMove}
                disabled={newFolderLoading || !newFolderName.trim()}
                className="text-xs text-green-600 hover:underline disabled:opacity-50"
              >
                {newFolderLoading ? "…" : "Go"}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreatingNew(true)}
              className="w-full text-left px-3 py-1.5 text-blue-600 hover:bg-magic-header flex items-center gap-1"
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
              New folder…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
