"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Copy, Trash2 } from "lucide-react";
import Spinner from "@/components/Spinner";
import { confirmDelete } from "@/lib/confirmDelete";

interface FolderLite {
  id: number;
  name: string;
  company_id: number | null;
  company_name: string | null;
}

interface ProjectLite {
  id: number;
  name: string;
}

interface CompanyGroup {
  key: string;
  companyId: number | null;
  name: string;
  folders: FolderLite[];
}

/**
 * Per-row Copy + Delete controls for a quotation in the project view.
 *
 * Copy opens a tree — Company → Client → Project — so the user can drop an
 * editable copy anywhere, not just the current project. A "this project"
 * shortcut keeps the common case one click. The copy is always a brand-new
 * quotation (fresh QY-ref) built from the source, so the original is never
 * touched. Delete soft-deletes after a confirm.
 *
 * The menu is rendered into a portal on document.body so the surrounding
 * project card's overflow can't clip it.
 */
export default function QuotationRowActions({
  quotationId,
  currentProjectId,
  currentFolderId,
  currentProjectName,
  onChanged,
}: {
  quotationId: number;
  currentProjectId: number;
  currentFolderId: number;
  currentProjectName: string;
  onChanged: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const [folders, setFolders] = useState<FolderLite[] | null>(null);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [expandedFolder, setExpandedFolder] = useState<number | null>(null);
  const [projectsByFolder, setProjectsByFolder] = useState<
    Record<number, ProjectLite[]>
  >({});
  const [loadingFolder, setLoadingFolder] = useState<number | null>(null);

  const [copyingTarget, setCopyingTarget] = useState<number | null>(null);
  const [status, setStatus] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Position the menu relative to the trigger button, clamped on-screen.
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const menuWidth = 288;
      const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
      const left = Math.max(8, Math.min(rect.right - menuWidth, vw - menuWidth - 8));
      setPos({ top: rect.bottom + 4, left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Load the client list (with their companies) the first time the menu opens.
  const loadFolders = useCallback(async () => {
    setFoldersError(null);
    try {
      const res = await fetch("/api/folders", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load clients (${res.status})`);
      const data = (await res.json()) as { folders?: FolderLite[] };
      setFolders(data.folders ?? []);
    } catch (err) {
      setFoldersError((err as Error).message);
      setFolders([]);
    }
  }, []);

  const openMenu = () => {
    setStatus(null);
    setOpen((v) => !v);
    if (folders === null) void loadFolders();
  };

  const loadProjects = useCallback(
    async (folderId: number) => {
      if (projectsByFolder[folderId]) return;
      setLoadingFolder(folderId);
      try {
        const res = await fetch(`/api/projects?folder_id=${folderId}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { projects?: ProjectLite[] };
        setProjectsByFolder((prev) => ({
          ...prev,
          [folderId]: data.projects ?? [],
        }));
      } catch {
        setProjectsByFolder((prev) => ({ ...prev, [folderId]: [] }));
      } finally {
        setLoadingFolder(null);
      }
    },
    [projectsByFolder],
  );

  const copyTo = useCallback(
    async (folderId: number, projectId: number) => {
      setCopyingTarget(projectId);
      setStatus(null);
      try {
        const srcRes = await fetch(`/api/quotations?id=${quotationId}`, {
          cache: "no-store",
        });
        if (!srcRes.ok) {
          throw new Error(`Failed to load quotation (${srcRes.status})`);
        }
        const srcData = (await srcRes.json()) as {
          quotation: Record<string, unknown> | null;
        };
        const src = srcData.quotation;
        if (!src) throw new Error("Quotation not found.");

        const parseJson = (v: unknown, fallback: unknown) => {
          if (typeof v === "string") {
            try {
              return JSON.parse(v);
            } catch {
              return fallback;
            }
          }
          return v ?? fallback;
        };
        const items = parseJson(src.items_json, []);
        const config = parseJson(src.config_json, {});
        const totals = parseJson(src.totals_json, {});

        const payload = {
          project_name: src.project_name
            ? `${String(src.project_name)} (copy)`
            : "Untitled Quotation (copy)",
          client_name: (src.client_name as string) || undefined,
          client_email: (src.client_email as string) || undefined,
          client_phone: (src.client_phone as string) || undefined,
          sales_engineer: (src.sales_engineer as string) || undefined,
          prepared_by: (src.prepared_by as string) || undefined,
          site_name: (src.site_name as string) || "SITE",
          tax_percent: Number(src.tax_percent ?? 16),
          folder_id: folderId,
          project_id: projectId,
          items: Array.isArray(items) ? items : [],
          totals:
            totals && typeof totals === "object" && !Array.isArray(totals)
              ? totals
              : {},
          config:
            config && typeof config === "object" && !Array.isArray(config)
              ? config
              : {},
        };

        const res = await fetch("/api/quotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as {
          quotation?: { id: number; ref: string };
          error?: string;
        };
        if (!res.ok || !data.quotation) {
          throw new Error(data.error || "Failed to copy quotation.");
        }
        setOpen(false);
        setStatus({
          kind: "success",
          text: `Copied to ${data.quotation.ref}`,
        });
        onChanged();
      } catch (err) {
        setStatus({ kind: "error", text: (err as Error).message });
      } finally {
        setCopyingTarget(null);
      }
    },
    [quotationId, onChanged],
  );

  const handleDelete = useCallback(async () => {
    if (deleting) return;
    if (!confirmDelete("Permanently delete this quotation?")) {
      return;
    }
    setDeleting(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/quotations?id=${quotationId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Delete failed (${res.status})`);
      }
      onChanged();
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    } finally {
      setDeleting(false);
    }
  }, [deleting, quotationId, onChanged]);

  // Group the flat folder list into companies for the tree.
  const groups: CompanyGroup[] = (() => {
    if (!folders) return [];
    const map = new Map<string, CompanyGroup>();
    for (const f of folders) {
      const key = f.company_id != null ? `c${f.company_id}` : "none";
      if (!map.has(key)) {
        map.set(key, {
          key,
          companyId: f.company_id,
          name: f.company_name || "No company",
          folders: [],
        });
      }
      map.get(key)!.folders.push(f);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  })();

  const menu =
    open && pos ? (
      <div
        ref={menuRef}
        style={{ top: pos.top, left: pos.left, width: 288 }}
        className="fixed z-[1000] max-h-96 overflow-y-auto rounded-md border border-magic-border bg-white py-1 text-sm shadow-lg"
      >
        <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wide text-magic-ink/50">
          Copy into…
        </div>

        {/* Shortcut: copy into the project we're already viewing. */}
        <button
          onClick={() => copyTo(currentFolderId, currentProjectId)}
          disabled={copyingTarget != null}
          className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-magic-header disabled:opacity-50"
        >
          <span className="truncate font-medium text-magic-red">
            This project · {currentProjectName || "Current"}
          </span>
          {copyingTarget === currentProjectId && (
            <Spinner size={12} className="shrink-0" />
          )}
        </button>

        <div className="my-1 border-t border-magic-border/60" />

        {folders === null ? (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-magic-ink/50">
            <Spinner size={12} /> Loading…
          </div>
        ) : foldersError ? (
          <div className="px-3 py-2 text-xs text-red-600">{foldersError}</div>
        ) : groups.length === 0 ? (
          <div className="px-3 py-2 text-xs italic text-magic-ink/50">
            No clients available.
          </div>
        ) : (
          groups.map((g) => {
            const companyOpen = expandedCompany === g.key;
            return (
              <div key={g.key}>
                <button
                  onClick={() =>
                    setExpandedCompany(companyOpen ? null : g.key)
                  }
                  className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left font-semibold text-magic-ink hover:bg-magic-header"
                >
                  <ChevronRight
                    className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                      companyOpen ? "rotate-90" : ""
                    }`}
                  />
                  <span className="truncate">{g.name}</span>
                </button>
                {companyOpen &&
                  g.folders.map((f) => {
                    const folderOpen = expandedFolder === f.id;
                    const projects = projectsByFolder[f.id];
                    return (
                      <div key={f.id}>
                        <button
                          onClick={() => {
                            const next = folderOpen ? null : f.id;
                            setExpandedFolder(next);
                            if (next != null) void loadProjects(f.id);
                          }}
                          className="flex w-full items-center gap-1.5 py-1.5 pl-6 pr-2 text-left text-magic-ink/90 hover:bg-magic-header"
                        >
                          <ChevronRight
                            className={`h-3 w-3 shrink-0 transition-transform ${
                              folderOpen ? "rotate-90" : ""
                            }`}
                          />
                          <span className="truncate">{f.name}</span>
                        </button>
                        {folderOpen && (
                          <div>
                            {loadingFolder === f.id && !projects ? (
                              <div className="flex items-center gap-2 py-1 pl-12 pr-3 text-xs text-magic-ink/50">
                                <Spinner size={10} />
                                Loading…
                              </div>
                            ) : projects && projects.length > 0 ? (
                              projects.map((p) => (
                                <button
                                  key={p.id}
                                  onClick={() => copyTo(f.id, p.id)}
                                  disabled={copyingTarget != null}
                                  className="flex w-full items-center justify-between gap-2 py-1.5 pl-12 pr-3 text-left text-magic-ink/80 hover:bg-magic-header disabled:opacity-50"
                                >
                                  <span className="truncate">{p.name}</span>
                                  {copyingTarget === p.id && (
                                    <Spinner size={12} className="shrink-0" />
                                  )}
                                </button>
                              ))
                            ) : (
                              <div className="py-1 pl-12 pr-3 text-xs italic text-magic-ink/40">
                                No projects.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    ) : null;

  return (
    <div ref={wrapRef} className="flex items-center gap-1.5">
      {status && (
        <span
          className={`text-[10px] ${
            status.kind === "success" ? "text-emerald-600" : "text-red-600"
          }`}
        >
          {status.text}
        </span>
      )}
      <button
        ref={buttonRef}
        type="button"
        draggable={false}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openMenu();
        }}
        disabled={copyingTarget != null}
        className="flex items-center gap-1 rounded-md border border-magic-border px-2 py-0.5 text-[11px] font-medium text-magic-ink/70 transition-colors hover:border-magic-red hover:text-magic-red disabled:opacity-50"
        title="Make an editable copy of this quotation — choose where it goes"
      >
        <Copy className="h-3 w-3" />
        Copy
      </button>
      <button
        type="button"
        draggable={false}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void handleDelete();
        }}
        disabled={deleting}
        className="flex items-center gap-1 rounded-md border border-magic-border px-2 py-0.5 text-[11px] font-medium text-magic-ink/60 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        title="Delete this quotation (moves it to the trash)"
      >
        {deleting ? (
          <Spinner size={10} />
        ) : (
          <Trash2 className="h-3 w-3" />
        )}
        Delete
      </button>
      {mounted && menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
