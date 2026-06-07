"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Spinner from "@/components/Spinner";
import QuotationRowActions from "@/components/QuotationRowActions";

interface Project {
  id: number;
  folder_id: number;
  owner_id: number | null;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface QuotationRow {
  id: number;
  ref: string;
  project_name: string | null;
  status?: string | null;
  parent_ref?: string | null;
  created_at: string;
}

interface PoRow {
  id: number;
  po_number: string;
  supplier: string | null;
  amount: string | number;
  currency: string;
  status: string;
  created_at: string;
}

interface FileRow {
  id: number;
  project_id: number;
  kind: "quotation" | "po" | "boq" | "other" | string;
  filename: string;
  mime: string;
  size_bytes: number;
  created_at: string;
}

type FileKind = "quotation" | "po" | "boq" | "other";

type DragKind = "quotation" | "po" | "file";

interface DragInfo {
  kind: DragKind;
  id: number;
  sourceProjectId: number;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Mirrors `canAuthorQuotation` from src/lib/modules.ts so the client can
 * hide quotation authoring affordances (the in-app Designer entry point
 * and the "Upload existing quotation" file uploader) for plain sales /
 * sales_manager users. Sales raise an RFQ via RequestQuotationButton —
 * they don't design or upload quotations. The server-side /api/quotations
 * POST and /api/project-files endpoints re-enforce the same rule, so
 * this is purely a UI affordance and a stale tab can't smuggle either.
 *
 * Returns null while loading so callers can show a skeleton; true /
 * false once /api/auth/me has resolved.
 */
function useCanAuthorQuotation(): boolean | null {
  const [canAuthor, setCanAuthor] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = (await res.json()) as {
          user?: { role?: string } | null;
          module_roles?: Array<{ module: string; role: string }>;
        };
        if (cancelled) return;
        if (data.user?.role === "admin") {
          setCanAuthor(true);
          return;
        }
        const crm = (data.module_roles ?? [])
          .filter((r) => r.module === "crm")
          .map((r) => r.role);
        setCanAuthor(crm.includes("presales") || crm.includes("presales_manager"));
      } catch {
        if (!cancelled) setCanAuthor(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return canAuthor;
}

/**
 * Per-folder Projects + Files dashboard.
 *
 * The component is intentionally self-contained: it lists projects under
 * a single folder, lets the user pick one, and renders three panels for
 * the chosen project (Quotations / POs / Files). Files are uploaded
 * directly to Supabase Storage via signed URLs (browser → Storage; never
 * through this app's API), so PDF / spreadsheet uploads aren't capped by
 * Vercel's request body limit.
 */
export default function FolderProjectsClient({
  folderId,
  folderName,
}: {
  folderId: number;
  folderName: string;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Search inside the project picker. The sidebar can get long once a
  // client accumulates a year or two of projects, so a tiny filter box
  // makes drill-down survivable. Filtering is client-side over name
  // and description.
  const [projectQuery, setProjectQuery] = useState("");

  // Drag-and-drop state for moving items between projects. `dragInfo`
  // identifies what's being dragged (a quotation, PO, or file) and its
  // origin project; `dropTargetId` drives the hover highlight on the
  // sidebar button. `refreshKey` bumps after a successful move so the
  // active tab re-fetches its list.
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleDropOnProject = useCallback(
    async (targetProjectId: number) => {
      const di = dragInfo;
      setDragInfo(null);
      setDropTargetId(null);
      if (!di || di.sourceProjectId === targetProjectId) return;
      try {
        let res: Response;
        if (di.kind === "quotation") {
          res = await fetch(`/api/quotations?id=${di.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: targetProjectId }),
          });
        } else if (di.kind === "po") {
          res = await fetch(`/api/purchase-orders?id=${di.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: targetProjectId }),
          });
        } else {
          res = await fetch(`/api/project-files/${di.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: targetProjectId }),
          });
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          alert(data.error || `HTTP ${res.status}`);
          return;
        }
        setRefreshKey((k) => k + 1);
      } catch (err) {
        alert((err as Error).message);
      }
    },
    [dragInfo],
  );

  const reloadProjects = useCallback(async () => {
    setLoadingProjects(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects?folder_id=${folderId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { projects?: Project[] };
      const list = data.projects ?? [];
      setProjects(list);
      // Pick the first project by default. The migration creates a
      // "Default Project" for every existing folder, so a brand-new
      // visit always lands on something rather than an empty pane.
      setActiveProjectId((prev) => {
        if (prev && list.some((p) => p.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (err) {
      setError((err as Error).message || "Failed to load projects");
    } finally {
      setLoadingProjects(false);
    }
  }, [folderId]);

  useEffect(() => {
    void reloadProjects();
  }, [reloadProjects]);

  const activeProject =
    projects.find((p) => p.id === activeProjectId) || null;

  // On screens narrower than lg the project sidebar collapses by
  // default so the actual project content gets the screen real estate.
  // The header doubles as a toggle on mobile and a static label on
  // desktop where the sidebar is always visible.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // First paint: show a real loading animation instead of the empty
  // two-pane shell (which used to flash "Select a project on the left"
  // before the project list had even arrived). We only gate the very
  // first load — once projects are in hand the live layout takes over,
  // including its own "No projects yet" empty state.
  if (loadingProjects) {
    return (
      <div className="rounded-2xl border border-magic-border bg-white p-12 flex items-center justify-center">
        <Spinner size={28} label={`Loading ${folderName}…`} />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <aside className="rounded-2xl border border-magic-border bg-white p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen((v) => !v)}
            aria-expanded={mobileSidebarOpen}
            className="flex min-w-0 items-center gap-2 text-left lg:cursor-default"
          >
            <h2 className="font-semibold text-sm text-magic-ink">
              Projects
              <span className="ml-1 text-magic-ink/40 lg:hidden">
                ({projects.length})
              </span>
            </h2>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 text-magic-ink/50 transition-transform lg:hidden ${
                mobileSidebarOpen ? "rotate-180" : ""
              }`}
              aria-hidden
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            {!mobileSidebarOpen && activeProject && (
              <span className="ml-1 truncate text-xs text-magic-ink/60 lg:hidden">
                · {activeProject.name}
              </span>
            )}
          </button>
          <NewProjectButton
            folderId={folderId}
            onCreated={(p) => {
              setProjects((prev) => [...prev, p]);
              setActiveProjectId(p.id);
              setMobileSidebarOpen(false);
            }}
          />
        </div>
        <div className={mobileSidebarOpen ? "block" : "hidden lg:block"}>
        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        {projects.length > 4 && (
          <input
            type="search"
            placeholder="Search projects…"
            value={projectQuery}
            onChange={(e) => setProjectQuery(e.target.value)}
            className="mb-2 w-full rounded border border-magic-border bg-white px-2 py-1 text-xs"
          />
        )}
        {loadingProjects ? (
          <div className="text-xs text-magic-ink/50">Loading projects…</div>
        ) : projects.length === 0 ? (
          <div className="text-xs text-magic-ink/50">
            No projects yet for {folderName}. Create the first one.
          </div>
        ) : (
          (() => {
            const lc = projectQuery.trim().toLowerCase();
            const visible = lc
              ? projects.filter((p) =>
                  [p.name, p.description]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase()
                    .includes(lc),
                )
              : projects;
            if (visible.length === 0) {
              return (
                <div className="text-xs text-magic-ink/50">
                  No projects match &quot;{projectQuery}&quot;.
                </div>
              );
            }
            return (
              <ul className="flex flex-col gap-1">
                {visible.map((p) => {
                  const isActive = p.id === activeProjectId;
                  const isDropTarget = dropTargetId === p.id;
                  // Only treat the button as a valid drop target when
                  // something is actually being dragged and the source
                  // project differs from this row. Dropping on the same
                  // project is a no-op so we don't even highlight.
                  const canAcceptDrop =
                    dragInfo !== null && dragInfo.sourceProjectId !== p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveProjectId(p.id);
                          setMobileSidebarOpen(false);
                        }}
                        onDragOver={(e) => {
                          if (!canAcceptDrop) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (dropTargetId !== p.id) setDropTargetId(p.id);
                        }}
                        onDragEnter={(e) => {
                          if (!canAcceptDrop) return;
                          e.preventDefault();
                          setDropTargetId(p.id);
                        }}
                        onDragLeave={() => {
                          if (dropTargetId === p.id) setDropTargetId(null);
                        }}
                        onDrop={(e) => {
                          if (!canAcceptDrop) return;
                          e.preventDefault();
                          void handleDropOnProject(p.id);
                        }}
                        className={`w-full text-left rounded-md px-3 py-2 text-sm border transition-colors ${
                          isDropTarget
                            ? "border-magic-red bg-magic-red/10 text-magic-ink ring-2 ring-magic-red/30"
                            : isActive
                              ? "border-magic-red bg-magic-red/5 text-magic-ink"
                              : "border-transparent hover:bg-magic-soft text-magic-ink/80"
                        }`}
                        title={p.description || undefined}
                      >
                        <div className="font-semibold truncate">{p.name}</div>
                        {p.description && (
                          <div className="text-[10px] text-magic-ink/50 truncate">
                            {p.description}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            );
          })()
        )}
        </div>
      </aside>

      <section className="min-w-0">
        {activeProject ? (
          <ProjectPanel
            project={activeProject}
            refreshKey={refreshKey}
            onDragStart={(kind, id) =>
              setDragInfo({ kind, id, sourceProjectId: activeProject.id })
            }
            onDragEnd={() => {
              setDragInfo(null);
              setDropTargetId(null);
            }}
            onProjectUpdate={(updated) => {
              setProjects((prev) =>
                prev.map((p) => (p.id === updated.id ? updated : p)),
              );
            }}
            onProjectDelete={(id) => {
              setProjects((prev) => prev.filter((p) => p.id !== id));
              setActiveProjectId((prev) =>
                prev === id ? projects.find((p) => p.id !== id)?.id ?? null : prev,
              );
            }}
          />
        ) : (
          <div className="rounded-2xl border border-magic-border bg-white p-8 text-center text-sm text-magic-ink/60">
            Select a project on the left, or create a new one.
          </div>
        )}
      </section>
    </div>
  );
}

function NewProjectButton({
  folderId,
  onCreated,
}: {
  folderId: number;
  onCreated: (p: Project) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_id: folderId,
          name: name.trim(),
          description: description.trim() || null,
        }),
      });
      const data = (await res.json()) as { project?: Project; error?: string };
      if (!res.ok || !data.project) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onCreated(data.project);
      setOpen(false);
      setName("");
      setDescription("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [folderId, name, description, onCreated]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-magic-red text-white px-2.5 py-1 text-xs font-semibold hover:bg-red-700"
      >
        + New
      </button>
    );
  }
  return (
    <div className="absolute z-30 mt-9 ml-[-260px] w-[260px] rounded-2xl border border-magic-border bg-white p-4 shadow-2xl">
      <div className="text-xs font-semibold uppercase text-magic-ink/60 mb-2">
        New project
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Project name"
        className="w-full rounded-md border border-magic-border px-2 py-1.5 text-sm mb-2"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="Optional description"
        className="w-full rounded-md border border-magic-border px-2 py-1.5 text-xs mb-2"
      />
      {error && (
        <div className="mb-2 rounded-md bg-red-50 px-2 py-1 text-[10px] text-red-700">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setName("");
            setDescription("");
            setError(null);
          }}
          disabled={busy}
          className="rounded-md border border-magic-border px-2 py-1 text-xs hover:bg-magic-soft disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !name.trim()}
          className="rounded-md bg-magic-red text-white px-2 py-1 text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}

function ProjectPanel({
  project,
  refreshKey,
  onDragStart,
  onDragEnd,
  onProjectUpdate,
  onProjectDelete,
}: {
  project: Project;
  refreshKey: number;
  onDragStart: (kind: DragKind, id: number) => void;
  onDragEnd: () => void;
  onProjectUpdate: (p: Project) => void;
  onProjectDelete: (id: number) => void;
}) {
  const [tab, setTab] = useState<"quotations" | "pos" | "boq" | "files">(
    "quotations",
  );
  return (
    <div className="rounded-2xl border border-magic-border bg-white">
      <ProjectHeader
        project={project}
        onProjectUpdate={onProjectUpdate}
        onProjectDelete={onProjectDelete}
      />
      <div className="border-b border-magic-border px-2 sm:px-4 flex gap-1 overflow-x-auto">
        {(
          [
            ["quotations", "Quotations"],
            ["pos", "Purchase Orders"],
            ["boq", "BOQ"],
            ["files", "Files"],
          ] as const
        ).map(([key, label]) => {
          const isActive = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`whitespace-nowrap px-3 sm:px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                isActive
                  ? "border-magic-red text-magic-red"
                  : "border-transparent text-magic-ink/60 hover:text-magic-ink"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="p-4">
        {tab === "quotations" && (
          <QuotationsTab
            project={project}
            refreshKey={refreshKey}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        )}
        {tab === "pos" && (
          <PosTab
            project={project}
            refreshKey={refreshKey}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        )}
        {tab === "boq" && (
          <FilesTab
            project={project}
            refreshKey={refreshKey}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            variant="boq"
          />
        )}
        {tab === "files" && (
          <FilesTab
            project={project}
            refreshKey={refreshKey}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            variant="media"
          />
        )}
      </div>
    </div>
  );
}

function ProjectHeader({
  project,
  onProjectUpdate,
  onProjectDelete,
}: {
  project: Project;
  onProjectUpdate: (p: Project) => void;
  onProjectDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(project.name);
    setDescription(project.description ?? "");
  }, [project.id, project.name, project.description]);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects?id=${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      });
      const data = (await res.json()) as { project?: Project; error?: string };
      if (!res.ok || !data.project) {
        alert(data.error || `HTTP ${res.status}`);
        return;
      }
      onProjectUpdate(data.project);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }, [project.id, name, description, onProjectUpdate]);

  const remove = useCallback(async () => {
    if (
      !confirm(
        `Delete project "${project.name}"? Quotations and POs filed under it will become unfiled.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/projects?id=${project.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        alert(data.error || `HTTP ${res.status}`);
        return;
      }
      onProjectDelete(project.id);
    } finally {
      setBusy(false);
    }
  }, [project.id, project.name, onProjectDelete]);

  if (editing) {
    return (
      <div className="px-4 pt-4 pb-3 border-b border-magic-border">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-magic-border px-2 py-1.5 text-base font-semibold mb-2"
        />
        <textarea
          value={description}
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="w-full rounded-md border border-magic-border px-2 py-1.5 text-sm mb-2"
        />
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setName(project.name);
              setDescription(project.description ?? "");
            }}
            disabled={busy}
            className="rounded-md border border-magic-border px-3 py-1.5 text-xs hover:bg-magic-soft disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !name.trim()}
            className="rounded-md bg-magic-red text-white px-3 py-1.5 text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-3 border-b border-magic-border flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-magic-ink truncate">
          {project.name}
        </h2>
        {project.description && (
          <p className="text-xs text-magic-ink/60 mt-0.5">
            {project.description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-md border border-magic-border px-2.5 py-1 text-xs hover:bg-magic-soft"
        >
          Rename
        </button>
        <button
          type="button"
          onClick={remove}
          className="rounded-md border border-red-200 text-red-700 px-2.5 py-1 text-xs hover:bg-red-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function QuotationsTab({
  project,
  refreshKey,
  onDragStart,
  onDragEnd,
}: {
  project: Project;
  refreshKey: number;
  onDragStart: (kind: DragKind, id: number) => void;
  onDragEnd: () => void;
}) {
  const [items, setItems] = useState<QuotationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Uploaded quotation files (kind='quotation') — old quotations that were
  // originally produced in Excel and just need a home under the project,
  // alongside the ones designed in-app.
  const [files, setFiles] = useState<FileRow[]>([]);
  // `reloadToken` re-runs the load effect once a row action (copy / delete)
  // lands so the list reflects the change without a manual refresh.
  const [reloadToken, setReloadToken] = useState(0);

  const loadFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/project-files?project_id=${project.id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { files?: FileRow[] };
      setFiles((data.files ?? []).filter((f) => f.kind === "quotation"));
    } catch {
      // Non-fatal: the uploaded-quotation list just stays empty; the real
      // quotations above are the primary content of this tab.
    }
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setItems(null);
      setError(null);
      try {
        const res = await fetch(
          `/api/quotations?project_id=${project.id}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { quotations?: QuotationRow[] };
        if (!cancelled) setItems(data.quotations ?? []);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    void load();
    void loadFiles();
    return () => {
      cancelled = true;
    };
  }, [project.id, refreshKey, reloadToken, loadFiles]);

  if (error) {
    return (
      <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
        {error}
      </div>
    );
  }

  // Plain sales (and sales_manager) raise an RFQ from the project header —
  // they don't design quotations in-app and they can't upload an existing
  // quotation file either. Hide both affordances; presales / admins still
  // see them. `null` means we're still resolving the role, so we hide
  // optimistically to avoid a flash of an unusable button.
  const canAuthor = useCanAuthorQuotation();
  const showAuthoring = canAuthor === true;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-magic-ink/60">
          {items === null
            ? "Loading…"
            : `${items.length} quotation${items.length === 1 ? "" : "s"}`}
        </span>
        {showAuthoring && (
          <Link
            href={`/designer?folder=${project.folder_id}&project=${project.id}`}
            className="rounded-md bg-magic-red text-white px-3 py-1.5 text-xs font-semibold hover:bg-red-700"
          >
            + New quotation in this project
          </Link>
        )}
      </div>
      {items === null ? (
        <div className="py-6 flex justify-center">
          <Spinner size={20} label="Loading quotations…" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-xs text-magic-ink/50">
          No quotations yet for this project.
        </div>
      ) : (
        <ul className="divide-y divide-magic-border/60 rounded-lg border border-magic-border overflow-hidden">
          {items.map((row) => (
            <li
              key={row.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(row.id));
                onDragStart("quotation", row.id);
              }}
              onDragEnd={onDragEnd}
              className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-magic-soft/40 cursor-grab active:cursor-grabbing"
              title="Drag onto a project in the sidebar to move this quotation"
            >
              <div className="min-w-0">
                <Link
                  href={`/quotation?id=${row.id}`}
                  className="font-mono text-sm text-magic-red hover:underline"
                  draggable={false}
                >
                  {row.ref}
                </Link>
                <span className="ml-2 text-sm text-magic-ink truncate">
                  {row.project_name || "—"}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <QuotationRowActions
                  quotationId={row.id}
                  currentProjectId={project.id}
                  currentFolderId={project.folder_id}
                  currentProjectName={project.name}
                  onChanged={() => setReloadToken((t) => t + 1)}
                />
                <span className="text-[10px] uppercase text-magic-ink/50">
                  {row.status || "active"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(showAuthoring || files.length > 0) && (
      <div className="mt-5 border-t border-magic-border/60 pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-magic-ink/60 mb-2">
          Existing quotation files
        </h4>
        {showAuthoring && (
          <FileUploader
            projectId={project.id}
            kind="quotation"
            variant="quotation"
            onUploaded={loadFiles}
          />
        )}
        <div className="mt-3">
          {files.length === 0 ? (
            <div className="text-xs text-magic-ink/50">
              {showAuthoring
                ? "No uploaded quotation files. Use the button above to attach an old Excel or PDF quotation."
                : "No uploaded quotation files yet."}
            </div>
          ) : (
            <ul className="divide-y divide-magic-border/60 rounded-lg border border-magic-border overflow-hidden">
              {files.map((f) => (
                <FileRowItem
                  key={f.id}
                  file={f}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onDeleted={(id) =>
                    setFiles((prev) => prev.filter((row) => row.id !== id))
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

function PosTab({
  project,
  refreshKey,
  onDragStart,
  onDragEnd,
}: {
  project: Project;
  refreshKey: number;
  onDragStart: (kind: DragKind, id: number) => void;
  onDragEnd: () => void;
}) {
  const [items, setItems] = useState<PoRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Uploaded PO files (kind='po'). The full PO designer is being reworked,
  // so for now this tab is an upload-first surface: attach the PO document
  // (Excel / PDF) here. Any purchase orders created earlier through the PO
  // module still surface in the list below so nothing is hidden.
  const [files, setFiles] = useState<FileRow[]>([]);

  const loadFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/project-files?project_id=${project.id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { files?: FileRow[] };
      setFiles((data.files ?? []).filter((f) => f.kind === "po"));
    } catch {
      // Non-fatal: the uploaded-PO list just stays empty.
    }
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setItems(null);
      setError(null);
      try {
        const res = await fetch(
          `/api/purchase-orders?project_id=${project.id}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { purchaseOrders?: PoRow[] };
        if (!cancelled) setItems(data.purchaseOrders ?? []);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    void load();
    void loadFiles();
    return () => {
      cancelled = true;
    };
  }, [project.id, refreshKey, loadFiles]);

  if (error) {
    return (
      <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div>
      <FileUploader
        projectId={project.id}
        kind="po"
        variant="po"
        onUploaded={loadFiles}
      />

      <div className="mt-4">
        {files.length === 0 ? (
          <div className="text-xs text-magic-ink/50">
            No purchase orders uploaded yet. Use the button above to attach a PO
            document.
          </div>
        ) : (
          <ul className="divide-y divide-magic-border/60 rounded-lg border border-magic-border overflow-hidden">
            {files.map((f) => (
              <FileRowItem
                key={f.id}
                file={f}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDeleted={(id) =>
                  setFiles((prev) => prev.filter((row) => row.id !== id))
                }
              />
            ))}
          </ul>
        )}
      </div>

      {items && items.length > 0 && (
        <div className="mt-5 border-t border-magic-border/60 pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-magic-ink/60 mb-2">
            Purchase orders from the PO module
          </h4>
          <ul className="divide-y divide-magic-border/60 rounded-lg border border-magic-border overflow-hidden">
            {items.map((row) => (
              <li
                key={row.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(row.id));
                  onDragStart("po", row.id);
                }}
                onDragEnd={onDragEnd}
                className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-magic-soft/40 cursor-grab active:cursor-grabbing"
                title="Drag onto a project in the sidebar to move this PO"
              >
                <div className="min-w-0">
                  <span className="font-mono text-sm">{row.po_number}</span>
                  <span className="ml-2 text-sm text-magic-ink/70 truncate">
                    {row.supplier || "—"}
                  </span>
                </div>
                <div className="text-xs text-magic-ink/60">
                  {row.currency} {Number(row.amount).toFixed(2)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * One component renders both the "BOQ" and the general "Files" tab.
 *
 *   - variant="boq"   → shows files saved with kind='boq'; uploads land
 *                       with kind='boq' so they stay in the BOQ tab.
 *   - variant="media" → shows everything else (DWGs, images, videos,
 *                       PDFs, archives). New uploads land with kind='other'
 *                       which keeps them in this tab. Quotation- and
 *                       PO-kind uploads live in their own tabs instead.
 */
function FilesTab({
  project,
  refreshKey,
  onDragStart,
  onDragEnd,
  variant,
}: {
  project: Project;
  refreshKey: number;
  onDragStart: (kind: DragKind, id: number) => void;
  onDragEnd: () => void;
  variant: "boq" | "media";
}) {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/project-files?project_id=${project.id}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { files?: FileRow[] };
      setFiles(data.files ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const visible = useMemo(
    () =>
      variant === "boq"
        ? files.filter((f) => f.kind === "boq")
        : files.filter(
            (f) =>
              f.kind !== "boq" && f.kind !== "quotation" && f.kind !== "po",
          ),
    [files, variant],
  );

  const uploadKind: FileKind = variant === "boq" ? "boq" : "other";
  const emptyLabel =
    variant === "boq"
      ? "No BOQ files yet."
      : "No project files yet. Drop in DWGs, images, videos, PDFs — anything related to the project.";

  return (
    <div>
      <FileUploader
        projectId={project.id}
        kind={uploadKind}
        variant={variant}
        onUploaded={reload}
      />

      {error && (
        <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="mt-4">
        {loading ? (
          <div className="py-6 flex justify-center">
            <Spinner size={20} label="Loading files…" />
          </div>
        ) : visible.length === 0 ? (
          <div className="text-xs text-magic-ink/50">{emptyLabel}</div>
        ) : (
          <ul className="divide-y divide-magic-border/60 rounded-lg border border-magic-border overflow-hidden">
            {visible.map((f) => (
              <FileRowItem
                key={f.id}
                file={f}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDeleted={(id) =>
                  setFiles((prev) => prev.filter((row) => row.id !== id))
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FileUploader({
  projectId,
  kind,
  variant,
  onUploaded,
}: {
  projectId: number;
  kind: FileKind;
  variant: "boq" | "media" | "quotation" | "po";
  onUploaded: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onPick = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setProgressLabel("Requesting upload URL…");
      try {
        // Phase 1 — sign-upload. Server validates project ownership and
        // size cap before issuing a Supabase signed URL.
        const signRes = await fetch("/api/project-files/sign-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            kind,
            filename: file.name,
            mime: file.type || "application/octet-stream",
            size_bytes: file.size,
          }),
        });
        const signData = (await signRes.json()) as {
          signedUrl?: string;
          storage_path?: string;
          error?: string;
        };
        if (!signRes.ok || !signData.signedUrl || !signData.storage_path) {
          throw new Error(signData.error || `HTTP ${signRes.status}`);
        }

        // Phase 2 — upload the bytes directly to Supabase Storage.
        // Vercel never sees the body, so the only effective limit is
        // our own per-MIME cap enforced in /sign-upload.
        setProgressLabel(`Uploading ${file.name}…`);
        const uploadRes = await fetch(signData.signedUrl, {
          method: "PUT",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
          },
          body: file,
        });
        if (!uploadRes.ok) {
          throw new Error(`Upload failed: ${uploadRes.status}`);
        }

        // Phase 3 — register the metadata. Once this succeeds the file
        // shows up in the list.
        setProgressLabel("Saving…");
        const regRes = await fetch("/api/project-files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            kind,
            filename: file.name,
            mime: file.type || "application/octet-stream",
            size_bytes: file.size,
            storage_path: signData.storage_path,
          }),
        });
        const regData = (await regRes.json()) as {
          file?: FileRow;
          error?: string;
        };
        if (!regRes.ok || !regData.file) {
          throw new Error(regData.error || `HTTP ${regRes.status}`);
        }
        onUploaded();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
        setProgressLabel(null);
      }
    },
    [projectId, kind, onUploaded],
  );

  const buttonLabel =
    variant === "boq"
      ? "Upload BOQ file"
      : variant === "quotation"
        ? "Upload existing quotation"
        : variant === "po"
          ? "Upload purchase order"
          : "Upload project file";
  const limitsHint =
    variant === "quotation"
      ? "Attach an old Excel / PDF quotation · spreadsheet or PDF up to 25 MB"
      : variant === "po"
        ? "Attach a PO document · spreadsheet or PDF up to 25 MB"
        : variant === "boq"
          ? "PDF / spreadsheet up to 25 MB · image up to 15 MB · DWG up to 50 MB"
          : "DWG up to 50 MB · video up to 200 MB · image up to 15 MB · PDF up to 25 MB · other up to 50 MB";

  return (
    <div className="rounded-lg border border-dashed border-magic-border bg-magic-soft/30 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="rounded-md bg-magic-red text-white px-3 py-1.5 text-xs font-semibold cursor-pointer hover:bg-red-700">
          {busy ? "Uploading…" : buttonLabel}
          <input
            type="file"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void onPick(file);
            }}
          />
        </label>
        <span className="text-[11px] text-magic-ink/60">{limitsHint}</span>
        {progressLabel && (
          <span className="text-[11px] text-magic-ink/70">{progressLabel}</span>
        )}
      </div>
      {error && (
        <div className="mt-2 rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}

function FileRowItem({
  file,
  onDragStart,
  onDragEnd,
  onDeleted,
}: {
  file: FileRow;
  onDragStart: (kind: DragKind, id: number) => void;
  onDragEnd: () => void;
  onDeleted: (id: number) => void;
}) {
  const [busy, setBusy] = useState<"view" | "download" | "delete" | null>(null);

  const open = useCallback(
    async (download: boolean) => {
      setBusy(download ? "download" : "view");
      try {
        const res = await fetch(
          `/api/project-files/${file.id}${download ? "?download=1" : ""}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !data.url) {
          alert(data.error || `HTTP ${res.status}`);
          return;
        }
        // For both view and download we just hand the signed URL to the
        // browser; the `?download=1` query asks the API to mint it with a
        // Content-Disposition header so the browser saves rather than
        // inlines.
        window.open(data.url, "_blank", "noopener");
      } finally {
        setBusy(null);
      }
    },
    [file.id],
  );

  const remove = useCallback(async () => {
    if (!confirm(`Delete "${file.filename}"? This cannot be undone.`)) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/project-files/${file.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        alert(data.error || `HTTP ${res.status}`);
        return;
      }
      onDeleted(file.id);
    } finally {
      setBusy(null);
    }
  }, [file.id, file.filename, onDeleted]);

  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(file.id));
        onDragStart("file", file.id);
      }}
      onDragEnd={onDragEnd}
      className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-magic-soft/40 cursor-grab active:cursor-grabbing"
      title="Drag onto a project in the sidebar to move this file"
    >
      <div className="min-w-0">
        <div className="text-sm text-magic-ink truncate">{file.filename}</div>
        <div className="text-[10px] text-magic-ink/50">
          {file.mime} · {formatBytes(file.size_bytes)}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={() => open(false)}
          disabled={busy !== null}
          className="rounded-md border border-magic-border px-2 py-1 text-xs hover:bg-magic-soft disabled:opacity-50"
        >
          {busy === "view" ? "…" : "View"}
        </button>
        <button
          type="button"
          onClick={() => open(true)}
          disabled={busy !== null}
          className="rounded-md border border-magic-border px-2 py-1 text-xs hover:bg-magic-soft disabled:opacity-50"
        >
          {busy === "download" ? "…" : "Download"}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy !== null}
          className="rounded-md border border-red-200 text-red-700 px-2 py-1 text-xs hover:bg-red-50 disabled:opacity-50"
        >
          {busy === "delete" ? "…" : "Delete"}
        </button>
      </div>
    </li>
  );
}
