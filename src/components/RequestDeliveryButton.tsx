"use client";

import { useState } from "react";
import { Truck } from "@/lib/icons";

/**
 * Raise a delivery request from a project (V1.8). Sales and projects use this
 * to hand a job to the delivery team — e.g. after a win or once a project is
 * sent to execution. Posts to /api/delivery/requests with the project linked;
 * the delivery module picks it up from its queue. The API enforces who may
 * raise a request, so this button can render wherever a project header does.
 */
export default function RequestDeliveryButton({
  projectId,
  projectName,
}: {
  projectId: number;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const [phone, setPhone] = useState("");
  const [priority, setPriority] = useState("normal");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/delivery/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          client_name: projectName,
          destination: destination.trim() || null,
          contact_phone: phone.trim() || null,
          priority,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      setDone(true);
      setOpen(false);
      setDestination("");
      setPhone("");
      setNotes("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
        <Truck className="h-3.5 w-3.5" /> Delivery requested
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-magic-border bg-white px-3 py-1.5 text-xs font-semibold text-magic-ink/75 hover:bg-magic-soft"
      >
        <Truck className="h-3.5 w-3.5" /> Request delivery
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-magic-border bg-white p-3 text-left shadow-lg">
          <p className="mb-2 text-[11px] text-magic-ink/50">
            Hand this project to the delivery team.
          </p>
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Destination / site address"
            className="mb-2 w-full rounded-lg border border-magic-border px-2 py-1.5 text-xs"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Contact phone"
            className="mb-2 w-full rounded-lg border border-magic-border px-2 py-1.5 text-xs"
          />
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="mb-2 w-full rounded-lg border border-magic-border bg-white px-2 py-1.5 text-xs"
          >
            <option value="low">Low priority</option>
            <option value="normal">Normal priority</option>
            <option value="high">High priority</option>
            <option value="urgent">Urgent</option>
          </select>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes for the driver (optional)"
            rows={2}
            className="mb-2 w-full rounded-lg border border-magic-border px-2 py-1.5 text-xs"
          />
          {error && (
            <p className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="flex-1 rounded-lg bg-magic-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-magic-red/90 disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send request"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/60 hover:bg-magic-soft"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
