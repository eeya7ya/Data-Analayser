"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface EditableCompany {
  id: number;
  name: string;
  website: string | null;
  industry: string | null;
  size_bucket: string | null;
  notes: string | null;
}

export function EditCompanyDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: EditableCompany;
  onClose: () => void;
  onSaved: (c: EditableCompany) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [website, setWebsite] = useState(initial.website ?? "");
  const [industry, setIndustry] = useState(initial.industry ?? "");
  const [sizeBucket, setSizeBucket] = useState(initial.size_bucket ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies?id=${initial.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          website: website.trim() || null,
          industry: industry.trim() || null,
          size_bucket: sizeBucket.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onSaved(data.company);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-magic-ink/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-magic-ink">Edit company</h3>
          <button
            onClick={onClose}
            className="text-magic-ink/50 hover:text-magic-ink"
          >
            ×
          </button>
        </div>
        <input
          type="text"
          placeholder="Company name (required)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          autoFocus
          className="w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            placeholder="Website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            disabled={busy}
            className="rounded border border-magic-border bg-white px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            disabled={busy}
            className="rounded border border-magic-border bg-white px-3 py-2 text-sm"
          />
        </div>
        <input
          type="text"
          placeholder="Size (e.g. 51–200)"
          value={sizeBucket}
          onChange={(e) => setSizeBucket(e.target.value)}
          disabled={busy}
          className="w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
        />
        <textarea
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
          rows={3}
          className="w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
        />
        {error && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !name.trim()}
            className="rounded bg-magic-red text-white px-3 py-1.5 text-xs font-semibold hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function EditCompanyButton({ company }: { company: EditableCompany }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft transition-colors"
      >
        Edit
      </button>
      {open && (
        <EditCompanyDialog
          initial={company}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
