"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Paperclip, FileText, Trash2 } from "@/lib/icons";
import Select from "@/components/Select";

/**
 * Sales quick-create lead (V1.8).
 *
 * One-screen lead intake on the dashboard so a salesperson never has to hop
 * between panels: type the request, point it at an existing client OR spin up a
 * new Company / Individual inline, and file it — the lead lands in the shared
 * presales queue exactly like the longer flow. Everything here calls the same
 * endpoints the CRM screens use (POST /api/companies, /api/folders, /api/leads),
 * so routing and permissions are unchanged; this is purely a faster entry point.
 */

type ClientMode = "existing" | "company" | "individual" | "none";

interface FolderOption {
  id: number;
  name: string;
  company_name: string | null;
}

interface ExistingFile {
  id: number;
  filename: string;
  kind: string;
}

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export default function QuickLeadCreate() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("normal");
  const [description, setDescription] = useState("");

  const [mode, setMode] = useState<ClientMode>("none");
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [existingFolderId, setExistingFolderId] = useState<string>("");
  const [companyName, setCompanyName] = useState("");
  const [clientName, setClientName] = useState("");
  const [individualName, setIndividualName] = useState("");
  const [projectName, setProjectName] = useState("");

  // Files to attach with the lead. `files` are new uploads picked here;
  // `existingFiles` are what's already in the selected client's folder (shown
  // for reference). Both land in / read from the folder's project BOQ tab.
  const [files, setFiles] = useState<File[]>([]);
  const [existingFiles, setExistingFiles] = useState<ExistingFile[]>([]);
  const [existingLoading, setExistingLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [busyNote, setBusyNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ref: string; id: number } | null>(null);

  // Lazy-load the client list only once the user picks "existing".
  useEffect(() => {
    if (mode !== "existing" || foldersLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/folders", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { folders?: FolderOption[] };
        if (!cancelled) {
          setFolders(data.folders ?? []);
          setFoldersLoaded(true);
        }
      } catch {
        /* leave the picker empty; the user can switch to New */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, foldersLoaded]);

  // When an existing client is selected, show the files already in its folder
  // (its default project's BOQ tab) for reference.
  useEffect(() => {
    if (mode !== "existing" || !existingFolderId) {
      setExistingFiles([]);
      return;
    }
    let cancelled = false;
    setExistingLoading(true);
    (async () => {
      try {
        const pid = await resolveProjectId(Number(existingFolderId));
        if (!pid) {
          if (!cancelled) setExistingFiles([]);
          return;
        }
        const res = await fetch(`/api/project-files?project_id=${pid}`, {
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as {
          files?: ExistingFile[];
        };
        if (!cancelled)
          setExistingFiles(Array.isArray(data.files) ? data.files : []);
      } catch {
        if (!cancelled) setExistingFiles([]);
      } finally {
        if (!cancelled) setExistingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, existingFolderId]);

  const reset = useCallback(() => {
    setTitle("");
    setPriority("normal");
    setDescription("");
    setMode("none");
    setExistingFolderId("");
    setCompanyName("");
    setClientName("");
    setIndividualName("");
    setProjectName("");
    setFiles([]);
    setExistingFiles([]);
    setError(null);
  }, []);

  /** The default project under a folder — files attach to a project, not a
   *  folder, and every folder is created with a default project. */
  async function resolveProjectId(folderId: number): Promise<number | null> {
    try {
      const res = await fetch(`/api/projects?folder_id=${folderId}`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        projects?: Array<{ id: number }>;
      };
      const list = Array.isArray(data.projects) ? data.projects : [];
      return list.length > 0 ? Number(list[0].id) : null;
    } catch {
      return null;
    }
  }

  /** Direct-to-R2 three-phase upload (sign → PUT → register), same as the
   *  project Files panel, filed as a BOQ so presales sees it in the BOQ tab. */
  async function uploadFile(projectId: number, file: File): Promise<void> {
    const mime = file.type || "application/octet-stream";
    const signRes = await fetch("/api/project-files/sign-upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        kind: "boq",
        filename: file.name,
        mime,
        size_bytes: file.size,
      }),
    });
    const signData = (await signRes.json().catch(() => ({}))) as {
      signedUrl?: string;
      storage_path?: string;
      error?: string;
    };
    if (!signRes.ok || !signData.signedUrl || !signData.storage_path) {
      throw new Error(signData.error || `Could not start upload for ${file.name}`);
    }
    const putRes = await fetch(signData.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: file,
    });
    if (!putRes.ok) throw new Error(`Upload failed for ${file.name}`);
    const regRes = await fetch("/api/project-files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        kind: "boq",
        filename: file.name,
        mime,
        size_bytes: file.size,
        storage_path: signData.storage_path,
      }),
    });
    const regData = (await regRes.json().catch(() => ({}))) as {
      file?: unknown;
      error?: string;
    };
    if (!regRes.ok || !regData.file) {
      throw new Error(regData.error || `Could not save ${file.name}`);
    }
  }

  async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error((data.error as string) || `HTTP ${res.status}`);
    }
    return data;
  }

  /** Resolve the folder_id to file the lead under, creating rows as needed. */
  async function resolveFolderId(): Promise<number | null> {
    if (mode === "existing") {
      const id = Number(existingFolderId);
      return Number.isFinite(id) && id > 0 ? id : null;
    }
    if (mode === "company") {
      const cName = companyName.trim();
      if (!cName) throw new Error("Company name is required.");
      const client = clientName.trim();
      if (!client) throw new Error("Client name is required.");
      const c = (await postJson("/api/companies", { name: cName })) as {
        company?: { id?: number };
      };
      const companyId = Number(c.company?.id);
      if (!Number.isFinite(companyId)) throw new Error("Could not create the company.");
      // company → client folder → project. The folder POST names its first
      // project from `project_name`, so the whole subfolder tree is created.
      const f = (await postJson("/api/folders", {
        name: client,
        kind: "company",
        company_id: companyId,
        project_name: projectName.trim() || client,
      })) as { folder?: { id?: number } };
      const fid = Number(f.folder?.id);
      return Number.isFinite(fid) ? fid : null;
    }
    if (mode === "individual") {
      const name = individualName.trim();
      if (!name) throw new Error("Customer name is required.");
      const f = (await postJson("/api/folders", {
        name,
        kind: "individual",
        project_name: projectName.trim() || name,
      })) as { folder?: { id?: number } };
      const fid = Number(f.folder?.id);
      return Number.isFinite(fid) ? fid : null;
    }
    return null; // "none" — unlinked; presales files it during claim.
  }

  async function submit() {
    if (!title.trim()) {
      setError("A short title for the request is required.");
      return;
    }
    // Files must land in a folder, so a client is required to attach them.
    if (files.length > 0 && mode === "none") {
      setError("Pick or create a client before attaching files.");
      return;
    }
    setBusy(true);
    setBusyNote(null);
    setError(null);
    try {
      const folderId = await resolveFolderId();
      const lead = (await postJson("/api/leads", {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        folder_id: folderId,
      })) as { id?: number; ref?: string };

      // Attach files to the folder's project so they show in its BOQ tab. A
      // single file that fails doesn't lose the lead — we surface the error but
      // keep the created lead.
      if (files.length > 0 && folderId) {
        const pid = await resolveProjectId(folderId);
        if (!pid) {
          throw new Error(
            "Lead created, but couldn't find a project on that client to store the files.",
          );
        }
        for (let i = 0; i < files.length; i++) {
          setBusyNote(`Uploading files… (${i + 1}/${files.length})`);
          await uploadFile(pid, files[i]);
        }
      }

      setBusyNote(null);
      setDone({ ref: String(lead.ref ?? ""), id: Number(lead.id) });
      reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setBusyNote(null);
    }
  }

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length) setFiles((prev) => [...prev, ...picked]);
    e.target.value = "";
  };
  const removeFile = (idx: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  if (!open) {
    return (
      <div className="rounded-2xl border border-dashed border-magic-border bg-white/60 p-4">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setDone(null);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-magic-red px-4 py-2 text-sm font-semibold text-white hover:bg-magic-red/90"
        >
          <Plus className="h-4 w-4" />
          New lead
        </button>
        {done && (
          <span className="ml-3 text-sm text-emerald-700">
            Created{" "}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => router.push(`/leads/${done.id}`)}
            >
              {done.ref || "lead"}
            </button>{" "}
            — it&apos;s in the presales queue.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-magic-border bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-magic-ink/70">
          New lead
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md p-1 text-magic-ink/50 hover:bg-magic-soft"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2 block text-xs font-semibold text-magic-ink/60">
          What does the client need?
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. CCTV + access control for a villa in Abdoun"
            className="mt-1 w-full rounded-lg border border-magic-border px-3 py-2 text-sm font-normal text-magic-ink"
          />
        </label>

        <label className="block text-xs font-semibold text-magic-ink/60">
          Priority
          <Select
            value={priority}
            onChange={(next) =>
              setPriority(next as (typeof PRIORITIES)[number])
            }
            className="mt-1 w-full rounded-lg border border-magic-border px-3 py-2 text-sm font-normal text-magic-ink bg-white"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </Select>
        </label>

        <label className="block text-xs font-semibold text-magic-ink/60">
          Client
          <Select
            value={mode}
            onChange={(next) => {
              const v = next as ClientMode;
              setMode(v);
              // Files need a folder to live in, so drop them if the lead is
              // switched back to "decide later".
              if (v === "none") setFiles([]);
            }}
            className="mt-1 w-full rounded-lg border border-magic-border px-3 py-2 text-sm font-normal text-magic-ink bg-white"
          >
            <option value="none">Decide later (presales files it)</option>
            <option value="existing">Existing client</option>
            <option value="company">New company</option>
            <option value="individual">New individual customer</option>
          </Select>
        </label>

        {mode === "existing" && (
          <label className="sm:col-span-2 block text-xs font-semibold text-magic-ink/60">
            Pick the client
            <Select
              value={existingFolderId}
              onChange={(next) => setExistingFolderId(next)}
              className="mt-1 w-full rounded-lg border border-magic-border px-3 py-2 text-sm font-normal text-magic-ink bg-white"
            >
              <option value="">
                {foldersLoaded ? "Select a client…" : "Loading…"}
              </option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.company_name ? ` · ${f.company_name}` : ""}
                </option>
              ))}
            </Select>
          </label>
        )}

        {mode === "company" && (
          <>
            <label className="block text-xs font-semibold text-magic-ink/60">
              Company name
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Najd Company"
                className="mt-1 w-full rounded-lg border border-magic-border px-3 py-2 text-sm font-normal text-magic-ink"
              />
            </label>
            <label className="block text-xs font-semibold text-magic-ink/60">
              Client name
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. Al-Hashimiah School"
                className="mt-1 w-full rounded-lg border border-magic-border px-3 py-2 text-sm font-normal text-magic-ink"
              />
            </label>
            <label className="sm:col-span-2 block text-xs font-semibold text-magic-ink/60">
              Project name
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. CCTV & access control (defaults to the client name)"
                className="mt-1 w-full rounded-lg border border-magic-border px-3 py-2 text-sm font-normal text-magic-ink"
              />
            </label>
          </>
        )}

        {mode === "individual" && (
          <>
            <label className="block text-xs font-semibold text-magic-ink/60">
              Customer name
              <input
                value={individualName}
                onChange={(e) => setIndividualName(e.target.value)}
                placeholder="e.g. Laith Talib"
                className="mt-1 w-full rounded-lg border border-magic-border px-3 py-2 text-sm font-normal text-magic-ink"
              />
            </label>
            <label className="block text-xs font-semibold text-magic-ink/60">
              Project name
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="defaults to the customer name"
                className="mt-1 w-full rounded-lg border border-magic-border px-3 py-2 text-sm font-normal text-magic-ink"
              />
            </label>
          </>
        )}

        {mode !== "none" && (
          <div className="sm:col-span-2 space-y-2">
            <div>
              <span className="block text-xs font-semibold text-magic-ink/60">
                Files
              </span>
              <p className="text-[11px] text-magic-ink/45">
                Attach the RFQ, BOQ, drawings or photos — they&apos;re saved in
                the client&apos;s folder (BOQs / Files) for presales.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={onPickFiles}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-dashed border-magic-border bg-magic-soft/40 px-3 py-2 text-xs font-semibold text-magic-ink/70 hover:border-magic-red/40 hover:text-magic-red"
            >
              <Paperclip className="h-4 w-4" />
              Attach files
            </button>

            {files.length > 0 && (
              <ul className="space-y-1">
                {files.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded-lg border border-magic-border bg-white px-2.5 py-1.5 text-xs"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-magic-ink/40" />
                    <span className="min-w-0 flex-1 truncate text-magic-ink/80">
                      {f.name}
                    </span>
                    <span className="shrink-0 text-magic-ink/40">
                      {(f.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="shrink-0 text-magic-ink/40 hover:text-magic-red"
                      aria-label={`Remove ${f.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {mode === "existing" && existingFolderId && (
              <div className="rounded-lg border border-magic-border/70 bg-magic-soft/30 px-2.5 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-magic-ink/45">
                  Already in this client
                </span>
                {existingLoading ? (
                  <p className="mt-1 text-[11px] text-magic-ink/45">Loading…</p>
                ) : existingFiles.length === 0 ? (
                  <p className="mt-1 text-[11px] text-magic-ink/40">
                    No files yet.
                  </p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {existingFiles.map((f) => (
                      <li
                        key={f.id}
                        className="flex items-center gap-2 text-[11px] text-magic-ink/70"
                      >
                        <FileText className="h-3 w-3 shrink-0 text-magic-ink/35" />
                        <span className="min-w-0 flex-1 truncate">
                          {f.filename}
                        </span>
                        <span className="shrink-0 uppercase text-magic-ink/35">
                          {f.kind}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        <label className="sm:col-span-2 block text-xs font-semibold text-magic-ink/60">
          Notes (optional)
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-magic-border px-3 py-2 text-sm font-normal text-magic-ink"
          />
        </label>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-magic-red px-4 py-2 text-sm font-semibold text-white hover:bg-magic-red/90 disabled:opacity-50"
        >
          {busy ? busyNote ?? "Creating…" : "Create lead"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-magic-border px-4 py-2 text-sm font-semibold text-magic-ink/70 hover:bg-magic-soft"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
