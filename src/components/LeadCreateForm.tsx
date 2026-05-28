"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LEAD_PRIORITIES } from "@/lib/leadConstants";

/**
 * Lead opening form. Captures the bare minimum — title, optional
 * description, priority, and source label.
 *
 * V1.3D — when opened as a Request for Quotation from a client / project,
 * the company + client folder (+ contact) arrive pre-resolved via
 * `context` and are smart-assigned to the lead. They render as read-only
 * chips here (sales shouldn't re-pick what the page already knows) and are
 * sent with the create request; the server re-validates them. Any other
 * linkage is still filled in later from the lead detail page.
 */
export interface LeadContext {
  folderId?: number | null;
  companyId?: number | null;
  contactId?: number | null;
  clientName?: string | null;
  companyName?: string | null;
  prefillTitle?: string | null;
}

export default function LeadCreateForm({
  context,
}: {
  context?: LeadContext;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(context?.prefillTitle ?? "");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState("");
  const [priority, setPriority] = useState<string>("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRfq = Boolean(context?.folderId || context?.companyId);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          source: source.trim() || null,
          priority,
          company_id: context?.companyId ?? null,
          folder_id: context?.folderId ?? null,
          contact_id: context?.contactId ?? null,
        }),
      });
      const data = (await res.json()) as { id?: number; error?: string };
      if (!res.ok || !data.id) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      router.push(`/leads/${data.id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border border-magic-border bg-white p-5 shadow-sm"
    >
      {isRfq && (
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
        <label className="block text-xs font-semibold uppercase tracking-wide text-magic-ink/60">
          Title <span className="text-magic-red">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="e.g. Acme Corp — Office HVAC refit"
          className="mt-1 w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-magic-ink/60">
          Description / scope
        </label>
        <textarea
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does the client need? Any known constraints, budget hints, technical scope, …"
          className="mt-1 w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-magic-ink/60">
            Priority
          </label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="mt-1 w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
          >
            {LEAD_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-magic-ink/60">
            Source
          </label>
          <input
            type="text"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="referral, website, cold call…"
            className="mt-1 w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-magic-border/60 pt-3">
        <button
          type="button"
          onClick={() => router.push("/leads")}
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
          {busy ? "Opening…" : "Open lead"}
        </button>
      </div>
    </form>
  );
}
