"use client";

import { useState, useMemo } from "react";
import { ChevronDown, Plus, Folder, Search, X } from "@/lib/icons";
import { cn } from "@/lib/pricing/utils";

interface Project {
  id: number;
  name: string;
  responsiblePerson?: string | null;
  parentProjectId?: number | null;
  revisionNumber?: number | null;
}

interface Props {
  projects: Project[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreateNew: (name: string) => Promise<void>;
}

export function ProjectSelector({
  projects,
  selectedId,
  onSelect,
  onCreateNew,
}: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const selected = projects.find((p) => p.id === selectedId);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, search]);

  // A revision badge ("v2", "v3"…) is only meaningful when more than
  // one row exists in the lineage. Compute that once so render stays cheap.
  const lineageSize = useMemo(() => {
    const counts = new Map<number, number>();
    for (const p of projects) {
      const root = p.parentProjectId ?? p.id;
      counts.set(root, (counts.get(root) ?? 0) + 1);
    }
    return counts;
  }, [projects]);

  const showRevision = (p: Project) => {
    const root = p.parentProjectId ?? p.id;
    return (lineageSize.get(root) ?? 0) > 1 && (p.revisionNumber ?? 1) >= 1;
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      await onCreateNew(newName.trim());
      setNewName("");
      setCreating(false);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium",
          "transition-colors hover:border-gray-300 hover:bg-gray-50",
          "focus:outline-none focus:ring-2 focus:ring-cyan-500/30",
          open && "border-gray-300 bg-gray-50"
        )}
      >
        <Folder className="h-3.5 w-3.5 text-cyan-500" />
        <span className="text-gray-700">
          {selected
            ? <>
                {selected.name}
                {showRevision(selected) && (
                  <span className="ml-1.5 rounded-full bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">
                    v{selected.revisionNumber ?? 1}
                  </span>
                )}
                {selected.responsiblePerson && (
                  <span className="ml-1.5 text-xs text-gray-400">— {selected.responsiblePerson}</span>
                )}
              </>
            : "Select Project…"}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-gray-400 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 min-w-[260px] rounded-xl border border-gray-200 bg-white shadow-lg shadow-gray-200">
          {/* Create new project option */}
          <div className="border-b border-gray-100 p-1">
            {creating ? (
              <div className="flex items-center gap-2 p-2">
                <input
                  autoFocus
                  type="text"
                  placeholder="Project name…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") {
                      setCreating(false);
                      setNewName("");
                    }
                  }}
                  className="flex-1 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:border-cyan-400 focus:outline-none"
                />
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim() || loading}
                  className="rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-400 disabled:opacity-50"
                >
                  {loading ? "…" : "Add"}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-cyan-600 transition-colors hover:bg-cyan-50"
              >
                <Plus className="h-3.5 w-3.5" />
                New Project…
              </button>
            )}
          </div>

          {/* Local search */}
          {projects.length > 3 && (
            <div className="border-b border-gray-100 p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search projects…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-md border border-gray-200 bg-gray-50 py-1.5 pl-7 pr-7 text-xs text-gray-700 placeholder-gray-400 focus:border-cyan-400 focus:outline-none"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Existing projects */}
          <div className="max-h-56 overflow-y-auto p-1">
            {projects.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-gray-400">
                No projects yet
              </p>
            ) : filteredProjects.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-gray-400">
                No matches for &ldquo;{search}&rdquo;
              </p>
            ) : (
              filteredProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onSelect(p.id);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors",
                    p.id === selectedId
                      ? "bg-cyan-50 text-cyan-700"
                      : "text-gray-700 hover:bg-gray-100"
                  )}
                >
                  <Folder
                    className={cn(
                      "h-3.5 w-3.5 flex-shrink-0",
                      p.id === selectedId ? "text-cyan-500" : "text-gray-400"
                    )}
                  />
                  <span className="truncate">
                    {p.name}
                    {showRevision(p) && (
                      <span className="ml-1.5 rounded-full bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">
                        v{p.revisionNumber ?? 1}
                      </span>
                    )}
                    {p.responsiblePerson && (
                      <span className="ml-1.5 text-xs text-gray-400">— {p.responsiblePerson}</span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Click outside */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setOpen(false);
            setCreating(false);
            setNewName("");
            setSearch("");
          }}
        />
      )}
    </div>
  );
}
