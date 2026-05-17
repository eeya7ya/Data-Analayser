"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LEAD_PRIORITIES } from "@/lib/leadConstants";

/**
 * Lead opening form. Captures the bare minimum — title, optional
 * description, priority, source label, and the date by which sales
 * expects a presales response (`requested_timeline_at`). Linkage to a
 * company / client folder / contact is intentionally deferred to the
 * lead detail page; presales fills those in as the deal develops.
 */
export default function LeadCreateForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState("");
  const [priority, setPriority] = useState<string>("normal");
  const [timeline, setTimeline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          requested_timeline_at: timeline || null,
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-magic-ink/60">
            Response needed by
          </label>
          <input
            type="date"
            value={timeline}
            onChange={(e) => setTimeline(e.target.value)}
            className="mt-1 w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
          />
          <p className="mt-1 text-[10px] text-magic-ink/50">
            Date by which sales expects the presales manager to assign and
            respond.
          </p>
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
