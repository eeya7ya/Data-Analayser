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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

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
        <div className="absolute right-0 z-50 mt-1 w-48 rounded-md border border-magic-border bg-white shadow-lg py-1 text-sm max-h-60 overflow-y-auto">
          <button
            onClick={() => moveTo(null)}
            className={`w-full text-left px-3 py-1.5 hover:bg-magic-header ${
              currentFolderId === null ? "font-semibold text-magic-red" : ""
            }`}
          >
            Unfiled
          </button>
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
        </div>
      )}
    </div>
  );
}
