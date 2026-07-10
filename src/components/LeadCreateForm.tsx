"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, FileText, Trash2 } from "lucide-react";
import { LEAD_PRIORITIES } from "@/lib/leadConstants";

/**
 * The single lead-opening form used everywhere (the /leads/new page, the
 * dashboard quick-create, RFQ-from-a-client, …). Instead of several divergent
 * copies, callers render THIS component and toggle the optional sections /
 * behaviour with props:
 *
 *   • `context`         — smart-assign from a client / project (RFQ). Shown as
 *                         read-only chips; hides the client picker.
 *   • `showClientPicker`— pick/create the Company → Client → Project inline.
 *   • `showFiles`       — attach files (saved to the folder's BOQ tab) + see
 *                         what's already in the selected client's folder.
 *   • `showSource`      — the lead source field.
 *   • `onCreated`       — called with the new lead instead of navigating to it
 *                         (the dashboard uses this to show an inline success).
 *   • `onCancel`        — Cancel handler; defaults to routing back to /leads.
 */
export interface LeadContext {
  folderId?: number | null;
  companyId?: number | null;
  contactId?: number | null;
  clientName?: string | null;
  companyName?: string | null;
  prefillTitle?: string | null;
}

type ClientMode = "none" | "existing" | "company" | "individual";

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

export default function LeadCreateForm({
  context,
  showClientPicker = true,
  showFiles = true,
  showSource = true,
  submitLabel = "Open lead",
  onCreated,
  onCancel,
}: {
  context?: LeadContext;
  showClientPicker?: boolean;
  showFiles?: boolean;
  showSource?: boolean;
  submitLabel?: string;
  onCreated?: (lead: { id: number; ref: string }) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const hasClientContext = Boolean(context?.folderId || context?.companyId);

  const [title, setTitle] = useState(context?.prefillTitle ?? "");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState("");
  const [priority, setPriority] = useState<string>("normal");

  const [mode, setMode] = useState<ClientMode>("none");
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [existingFolderId, setExistingFolderId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [clientName, setClientName] = useState("");
  const [individualName, setIndividualName] = useState("");
  const [projectName, setProjectName] = useState("");

  const [files, setFiles] = useState<File[]>([]);
  const [existingFiles, setExistingFiles] = useState<ExistingFile[]>([]);
  const [existingLoading, setExistingLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [busyNote, setBusyNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showPicker = showClientPicker && !hasClientContext;
  // Files need a folder to live in: available when a context folder exists, or
  // once the picker has a client selected (its folder is created on submit).
  const filesAvailable =
    showFiles &&
    ((hasClientContext && Boolean(context?.folderId)) ||
      (showPicker && mode !== "none"));

  // Lazy-load the client list once the user picks "existing".
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
        /* leave empty; the user can switch to New */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, foldersLoaded]);

  // Show the files already in the selected existing client's folder.
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

  async function postJson(
    url: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error((data.error as string) || `HTTP ${res.status}`);
    return data;
  }

  /** The default project under a folder — files attach to a project, and every
   *  folder is created with a default project. */
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

  /** Resolve the folder to file the lead under from the picker, creating the
   *  company / client / project rows as needed. */
  async function resolveFolderIdFromPicker(): Promise<number | null> {
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
      if (!Number.isFinite(companyId))
        throw new Error("Could not create the company.");
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

  /** Direct-to-R2 three-phase upload (sign → PUT → register), filed as a BOQ
   *  so presales see it in the project's BOQs / Files tab. */
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
    if (!regRes.ok || !regData.file)
      throw new Error(regData.error || `Could not save ${file.name}`);
  }

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length) setFiles((prev) => [...prev, ...picked]);
    e.target.value = "";
  };
  const removeFile = (idx: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (files.length > 0 && !filesAvailable) {
      setError("Pick or create a client before attaching files.");
      return;
    }
    setBusy(true);
    setBusyNote(null);
    try {
      let folderId: number | null;
      let companyId: number | null = null;
      let contactId: number | null = null;
      if (hasClientContext) {
        folderId = context?.folderId ?? null;
        companyId = context?.companyId ?? null;
        contactId = context?.contactId ?? null;
      } else {
        folderId = await resolveFolderIdFromPicker();
      }

      const lead = (await postJson("/api/leads", {
        title: title.trim(),
        description: description.trim() || null,
        source: showSource ? source.trim() || null : null,
        priority,
        company_id: companyId,
        folder_id: folderId,
        contact_id: contactId,
      })) as { id?: number; ref?: string };
      const leadId = Number(lead.id);
      if (!Number.isFinite(leadId)) throw new Error("Could not create the lead.");

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
      const created = { id: leadId, ref: String(lead.ref ?? "") };
      if (onCreated) onCreated(created);
      else {
        router.push(`/leads/${created.id}`);
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      setBusyNote(null);
    }
  }

  const field =
    "mt-1 w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red";
  const labelCls =
    "block text-xs font-semibold uppercase tracking-wide text-magic-ink/60";

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border border-magic-border bg-white p-5 shadow-sm"
    >
      {hasClientContext && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
            Smart-assigned
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
            {context?.companyName && (
              <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 font-semibold text-indigo-700 ring-1 ring-indigo-200">
                Company: {context.companyName}
              </span>
            )}
            {context?.clientName && (
              <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 font-semibold text-indigo-700 ring-1 ring-indigo-200">
                Client: {context.clientName}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-indigo-700/70">
            These are linked automatically. Presales will build the quotation
            against this client.
          </p>
        </div>
      )}

      <div>
        <label className={labelCls}>
          Title <span className="text-magic-red">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="e.g. Acme Corp — Office HVAC refit"
          className={field}
        />
      </div>

      <div>
        <label className={labelCls}>Description / scope</label>
        <textarea
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does the client need? Any known constraints, budget hints, technical scope, …"
          className={field}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className={field}
          >
            {LEAD_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>
        {showSource && (
          <div>
            <label className={labelCls}>Source</label>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="referral, website, cold call…"
              className={field}
            />
          </div>
        )}
      </div>

      {showPicker && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelCls}>Client</label>
            <select
              value={mode}
              onChange={(e) => {
                const v = e.target.value as ClientMode;
                setMode(v);
                if (v === "none") setFiles([]);
              }}
              className={field}
            >
              <option value="none">Decide later (presales files it)</option>
              <option value="existing">Existing client</option>
              <option value="company">New company</option>
              <option value="individual">New individual customer</option>
            </select>
          </div>

          {mode === "existing" && (
            <div className="sm:col-span-2">
              <label className={labelCls}>Pick the client</label>
              <select
                value={existingFolderId}
                onChange={(e) => setExistingFolderId(e.target.value)}
                className={field}
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
              </select>
            </div>
          )}

          {mode === "company" && (
            <>
              <div>
                <label className={labelCls}>Company name</label>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Najd Company"
                  className={field}
                />
              </div>
              <div>
                <label className={labelCls}>Client name</label>
                <input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="e.g. Al-Hashimiah School"
                  className={field}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Project name</label>
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g. CCTV & access control (defaults to the client name)"
                  className={field}
                />
              </div>
            </>
          )}

          {mode === "individual" && (
            <>
              <div>
                <label className={labelCls}>Customer name</label>
                <input
                  value={individualName}
                  onChange={(e) => setIndividualName(e.target.value)}
                  placeholder="e.g. Laith Talib"
                  className={field}
                />
              </div>
              <div>
                <label className={labelCls}>Project name</label>
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="defaults to the customer name"
                  className={field}
                />
              </div>
            </>
          )}
        </div>
      )}

      {filesAvailable && (
        <div className="space-y-2">
          <div>
            <label className={labelCls}>Files</label>
            <p className="text-[11px] text-magic-ink/45">
              Attach the RFQ, BOQ, drawings or photos — they&apos;re saved in the
              client&apos;s folder (BOQs / Files) for presales.
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
                <p className="mt-1 text-[11px] text-magic-ink/40">No files yet.</p>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {existingFiles.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center gap-2 text-[11px] text-magic-ink/70"
                    >
                      <FileText className="h-3 w-3 shrink-0 text-magic-ink/35" />
                      <span className="min-w-0 flex-1 truncate">{f.filename}</span>
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

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-magic-border/60 pt-3">
        <button
          type="button"
          onClick={() => (onCancel ? onCancel() : router.push("/leads"))}
          disabled={busy}
          className="rounded-lg border border-magic-border bg-white px-3 py-1.5 text-sm font-semibold text-magic-ink hover:bg-magic-soft disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-magic-red px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90 disabled:opacity-50"
        >
          {busy ? busyNote ?? "Opening…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
