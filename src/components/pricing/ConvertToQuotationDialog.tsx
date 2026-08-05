"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Building2,
  User,
  FolderOpen,
  Plus,
  Check,
} from "@/lib/icons";
import { cn } from "@/lib/pricing/utils";
import Spinner from "@/components/Spinner";
import Select from "@/components/Select";

interface Folder {
  id: number;
  name: string;
  kind: string | null;
  company_id?: number | null;
}

interface Project {
  id: number;
  name: string;
}

type Kind = "company" | "individual";
type Mode = "existing" | "new";

interface Props {
  open: boolean;
  /** Disable the confirm button + show spinner while the parent runs the
   *  save + convert round-trip. */
  converting: boolean;
  onClose: () => void;
  /** Called with the resolved client folder + project to file the new
   *  quotation under, plus the company context so the caller can land the
   *  user on the CRM drill-down (with breadcrumb) afterwards instead of a
   *  bare quotation page they can't navigate back from. */
  onConfirm: (args: {
    folderId: number | null;
    projectId: number | null;
    kind: Kind;
    companyId: number | null;
  }) => void;
}

/**
 * Pre-conversion client-assignment step. The user converts a pricing
 * sheet into a quotation that must live under a CRM client (a
 * `client_folders` row of kind company/individual) and one of that
 * client's projects — mirroring the Designer's "pick a client" flow.
 *
 * Two paths:
 *   • Existing — pick Company/Individual, then the client, then one of
 *     its projects.
 *   • New — pick Company/Individual, type the names; the dialog creates
 *     the company (company kind only), the client folder, and the
 *     project, then hands the ids back.
 *
 * All creation hits the host's existing CRM endpoints (/api/companies,
 * /api/folders, /api/projects) so the new client behaves exactly like
 * one created from the CRM UI.
 */
export function ConvertToQuotationDialog({
  open,
  converting,
  onClose,
  onConfirm,
}: Props) {
  const [mode, setMode] = useState<Mode>("existing");
  const [kind, setKind] = useState<Kind>("company");

  // Existing-client state
  const [folders, setFolders] = useState<Folder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  // Existing-client path: instead of being forced onto one of the client's
  // current projects, the user can spin up a NEW project inline.
  const [creatingNewProject, setCreatingNewProject] = useState(false);
  const [newProjectForExisting, setNewProjectForExisting] = useState("");

  // New-client state
  const [companyName, setCompanyName] = useState("");
  const [clientName, setClientName] = useState("");
  const [newProjectName, setNewProjectName] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset transient state whenever the dialog re-opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSelectedFolderId(null);
    setProjects([]);
    setSelectedProjectId(null);
    setCompanyName("");
    setClientName("");
    setNewProjectName("");
  }, [open]);

  // Load the client folders for the chosen kind (existing path only).
  useEffect(() => {
    if (!open || mode !== "existing") return;
    let cancelled = false;
    setFoldersLoading(true);
    setSelectedFolderId(null);
    setProjects([]);
    setSelectedProjectId(null);
    fetch(`/api/folders?kind=${kind}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { folders: [] }))
      .then((d: { folders?: Folder[] }) => {
        if (!cancelled) setFolders(d.folders ?? []);
      })
      .catch(() => {
        if (!cancelled) setFolders([]);
      })
      .finally(() => {
        if (!cancelled) setFoldersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, kind]);

  // Load the selected folder's projects.
  useEffect(() => {
    // Reset the inline new-project state whenever the client changes.
    setCreatingNewProject(false);
    setNewProjectForExisting("");
    if (selectedFolderId == null) {
      setProjects([]);
      setSelectedProjectId(null);
      return;
    }
    let cancelled = false;
    setProjectsLoading(true);
    fetch(`/api/projects?folder_id=${selectedFolderId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d: { projects?: Project[] }) => {
        if (cancelled) return;
        const list = d.projects ?? [];
        setProjects(list);
        setSelectedProjectId(list[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFolderId]);

  const busy = submitting || converting;

  const handleConfirm = useCallback(async () => {
    if (busy) return;
    setError(null);

    // ── Existing client ──────────────────────────────────────────────
    if (mode === "existing") {
      if (selectedFolderId == null) {
        setError("Pick a client first.");
        return;
      }
      const selectedFolder = folders.find((f) => f.id === selectedFolderId);
      const companyId =
        kind === "company" ? selectedFolder?.company_id ?? null : null;

      // Create a brand-new project under this client when asked, instead of
      // forcing the quotation onto an existing one.
      if (creatingNewProject) {
        const wantProject = newProjectForExisting.trim();
        if (!wantProject) {
          setError("Enter a name for the new project.");
          return;
        }
        setSubmitting(true);
        try {
          const pRes = await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              folder_id: selectedFolderId,
              name: wantProject,
            }),
          });
          if (!pRes.ok) {
            const e = await pRes.json().catch(() => ({}));
            throw new Error(e.error || "Failed to create the project");
          }
          const projectId = (await pRes.json()).project.id as number;
          onConfirm({ folderId: selectedFolderId, projectId, kind, companyId });
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setSubmitting(false);
        }
        return;
      }

      onConfirm({
        folderId: selectedFolderId,
        projectId: selectedProjectId,
        kind,
        companyId,
      });
      return;
    }

    // ── New client: create company (if needed) → folder → project ────
    const trimmedClient = clientName.trim();
    if (!trimmedClient) {
      setError("Client name is required.");
      return;
    }
    if (kind === "company" && !companyName.trim()) {
      setError("Company name is required.");
      return;
    }

    setSubmitting(true);
    try {
      let companyId: number | null = null;
      if (kind === "company") {
        const cRes = await fetch("/api/companies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: companyName.trim() }),
        });
        if (!cRes.ok) {
          const e = await cRes.json().catch(() => ({}));
          throw new Error(e.error || "Failed to create company");
        }
        companyId = (await cRes.json()).company.id as number;
      }

      const fRes = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedClient,
          kind,
          company_id: companyId,
          client_company: kind === "company" ? companyName.trim() : null,
        }),
      });
      if (!fRes.ok) {
        const e = await fRes.json().catch(() => ({}));
        throw new Error(e.error || "Failed to create client");
      }
      const folderId = (await fRes.json()).folder.id as number;

      // The folder POST auto-creates a "Default Project". Honour a custom
      // project name when given, otherwise reuse that default.
      let projectId: number | null = null;
      const wantProject = newProjectName.trim();
      if (wantProject) {
        const pRes = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder_id: folderId, name: wantProject }),
        });
        if (pRes.ok) projectId = (await pRes.json()).project.id as number;
      }
      if (projectId == null) {
        const pls = await fetch(`/api/projects?folder_id=${folderId}`, {
          cache: "no-store",
        })
          .then((r) => (r.ok ? r.json() : { projects: [] }))
          .catch(() => ({ projects: [] }));
        projectId = (pls.projects?.[0]?.id as number) ?? null;
      }

      onConfirm({ folderId, projectId, kind, companyId });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [
    busy,
    mode,
    kind,
    selectedFolderId,
    selectedProjectId,
    creatingNewProject,
    newProjectForExisting,
    clientName,
    companyName,
    newProjectName,
    onConfirm,
  ]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={busy ? undefined : onClose}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-magic-ink">
            Convert to Quotation
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <p className="text-sm text-gray-500">
            Assign this quotation to a client. Pick an existing client or
            create a new one.
          </p>

          {/* Mode toggle */}
          <div className="grid grid-cols-2 gap-2">
            <ModeButton
              active={mode === "existing"}
              onClick={() => setMode("existing")}
              icon={<FolderOpen className="h-4 w-4" />}
              label="Existing client"
            />
            <ModeButton
              active={mode === "new"}
              onClick={() => setMode("new")}
              icon={<Plus className="h-4 w-4" />}
              label="New client"
            />
          </div>

          {/* Kind toggle (shared) */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Client type
            </label>
            <div className="grid grid-cols-2 gap-2">
              <ModeButton
                active={kind === "company"}
                onClick={() => setKind("company")}
                icon={<Building2 className="h-4 w-4" />}
                label="Company"
              />
              <ModeButton
                active={kind === "individual"}
                onClick={() => setKind("individual")}
                icon={<User className="h-4 w-4" />}
                label="Individual"
              />
            </div>
          </div>

          {/* Existing path */}
          {mode === "existing" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
                  Client
                </label>
                {foldersLoading ? (
                  <div className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm text-gray-400">
                    <Spinner size={12} />
                    Loading…
                  </div>
                ) : folders.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-200 px-3 py-2.5 text-sm text-gray-400">
                    No {kind === "company" ? "companies" : "individuals"} yet —
                    switch to “New client”.
                  </p>
                ) : (
                  <Select
                    value={selectedFolderId ?? ""}
                    onChange={(next) =>
                      setSelectedFolderId(
                        next ? Number(next) : null,
                      )
                    }
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  >
                    <option value="">Select a client…</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                )}
              </div>

              {selectedFolderId != null && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
                    Project
                  </label>
                  {projectsLoading ? (
                    <div className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm text-gray-400">
                      <Spinner size={12} />
                      Loading…
                    </div>
                  ) : (
                    <>
                      <Select
                        value={creatingNewProject ? "__new__" : selectedProjectId ?? ""}
                        onChange={(next) => {
                          if (next === "__new__") {
                            setCreatingNewProject(true);
                          } else {
                            setCreatingNewProject(false);
                            setSelectedProjectId(
                              next ? Number(next) : null,
                            );
                          }
                        }}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                      >
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                        <option value="__new__">＋ New project…</option>
                      </Select>
                      {creatingNewProject && (
                        <input
                          type="text"
                          value={newProjectForExisting}
                          onChange={(e) => setNewProjectForExisting(e.target.value)}
                          placeholder="New project name"
                          className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                        />
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* New path */}
          {mode === "new" && (
            <div className="space-y-3">
              {kind === "company" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
                    Company name
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g. Acme Integrations LLC"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  />
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
                  {kind === "company" ? "Client / contact name" : "Client name"}
                </label>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder={kind === "company" ? "e.g. Acme — Riyadh branch" : "e.g. Mohammed Al-..."}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
                  Project name{" "}
                  <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Defaults to “Default Project”"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                />
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy || (mode === "existing" && selectedFolderId == null)}
            className="flex items-center gap-1.5 rounded-lg bg-magic-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-magic-red/90 disabled:opacity-60"
          >
            {busy ? (
              <Spinner size={12} />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {busy ? "Converting…" : "Create Quotation"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "border-cyan-300 bg-cyan-50 text-cyan-700"
          : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
