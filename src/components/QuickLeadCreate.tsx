"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

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

  const [busy, setBusy] = useState(false);
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

  const reset = useCallback(() => {
    setTitle("");
    setPriority("normal");
    setDescription("");
    setMode("none");
    setExistingFolderId("");
    setCompanyName("");
    setClientName("");
    setIndividualName("");
    setError(null);
  }, []);

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
      const c = (await postJson("/api/companies", { name: cName })) as {
        company?: { id?: number };
      };
      const companyId = Number(c.company?.id);
      if (!Number.isFinite(companyId)) throw new Error("Could not create the company.");
      const site = clientName.trim() || cName;
      const f = (await postJson("/api/folders", {
        name: site,
        kind: "company",
        company_id: companyId,
        project_name: site,
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
        project_name: name,
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
    setBusy(true);
    setError(null);
    try {
      const folderId = await resolveFolderId();
      const lead = (await postJson("/api/leads", {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        folder_id: folderId,
      })) as { id?: number; ref?: string };
      setDone({ ref: String(lead.ref ?? ""), id: Number(lead.id) });
      reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
          <select
            value={priority}
            onChange={(e) =>
              setPriority(e.target.value as (typeof PRIORITIES)[number])
            }
            className="mt-1 w-full rounded-lg border border-magic-border px-3 py-2 text-sm font-normal text-magic-ink bg-white"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-semibold text-magic-ink/60">
          Client
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ClientMode)}
            className="mt-1 w-full rounded-lg border border-magic-border px-3 py-2 text-sm font-normal text-magic-ink bg-white"
          >
            <option value="none">Decide later (presales files it)</option>
            <option value="existing">Existing client</option>
            <option value="company">New company</option>
            <option value="individual">New individual customer</option>
          </select>
        </label>

        {mode === "existing" && (
          <label className="sm:col-span-2 block text-xs font-semibold text-magic-ink/60">
            Pick the client
            <select
              value={existingFolderId}
              onChange={(e) => setExistingFolderId(e.target.value)}
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
            </select>
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
              Site / client name (optional)
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="defaults to the company name"
                className="mt-1 w-full rounded-lg border border-magic-border px-3 py-2 text-sm font-normal text-magic-ink"
              />
            </label>
          </>
        )}

        {mode === "individual" && (
          <label className="sm:col-span-2 block text-xs font-semibold text-magic-ink/60">
            Customer name
            <input
              value={individualName}
              onChange={(e) => setIndividualName(e.target.value)}
              placeholder="e.g. Laith Talib"
              className="mt-1 w-full rounded-lg border border-magic-border px-3 py-2 text-sm font-normal text-magic-ink"
            />
          </label>
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
          {busy ? "Creating…" : "Create lead"}
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
