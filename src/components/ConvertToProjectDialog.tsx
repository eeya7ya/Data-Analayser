"use client";

import { useState } from "react";
import LocationPicker from "@/components/LocationPicker";

/**
 * Sales-facing "Convert to Project" form. Captures the client contacts,
 * a map location (OpenStreetMap pin), priority and notes, then POSTs to
 * /api/project-handoffs which snapshots the quotation's BOQ and routes
 * it to a projects manager for assignment.
 */

const PRIORITIES: Array<{ value: string; label: string }> = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export default function ConvertToProjectDialog({
  quotationId,
  defaultContactName,
  defaultContactPhones,
  onClose,
  onConverted,
}: {
  quotationId: number;
  defaultContactName?: string | null;
  defaultContactPhones?: string | null;
  onClose: () => void;
  onConverted: () => void;
}) {
  const [contactName, setContactName] = useState(defaultContactName ?? "");
  const [contactPhones, setContactPhones] = useState(defaultContactPhones ?? "");
  const [siteAddress, setSiteAddress] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [priority, setPriority] = useState("normal");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/project-handoffs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quotation_id: quotationId,
          contact_name: contactName.trim() || null,
          contact_phones: contactPhones.trim() || null,
          site_address: siteAddress.trim() || null,
          location_lat: lat,
          location_lng: lng,
          priority,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onConverted();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-magic-ink/40 px-4 py-8"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-magic-ink">Convert to Project</h3>
            <p className="text-xs text-magic-ink/55">
              Snapshots this quotation as a BOQ and sends it to a projects
              manager to assign a member.
            </p>
          </div>
          <button onClick={onClose} className="text-magic-ink/50 hover:text-magic-ink">
            ×
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-magic-ink/70">Client contact</span>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Contact name"
              disabled={busy}
              className="mt-1 w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-magic-ink/70">Priority</span>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              disabled={busy}
              className="mt-1 w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-xs font-semibold text-magic-ink/70">Phone number(s)</span>
          <input
            type="text"
            value={contactPhones}
            onChange={(e) => setContactPhones(e.target.value)}
            placeholder="e.g. +962 7… , +962 7…"
            disabled={busy}
            className="mt-1 w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-magic-ink/70">Site address</span>
          <input
            type="text"
            value={siteAddress}
            onChange={(e) => setSiteAddress(e.target.value)}
            placeholder="Typed address (optional)"
            disabled={busy}
            className="mt-1 w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
          />
        </label>

        <div>
          <span className="text-xs font-semibold text-magic-ink/70">Site location</span>
          <div className="mt-1">
            <LocationPicker
              lat={lat}
              lng={lng}
              onChange={(la, ln) => {
                setLat(la);
                setLng(ln);
              }}
            />
          </div>
        </div>

        <label className="block">
          <span className="text-xs font-semibold text-magic-ink/70">Notes / parameters</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Anything the project team needs to know…"
            disabled={busy}
            className="mt-1 w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
          />
        </label>

        {error && (
          <p className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
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
            disabled={busy}
            className="rounded bg-magic-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
          >
            {busy ? "Converting…" : "Convert & send to projects"}
          </button>
        </div>
      </div>
    </div>
  );
}
