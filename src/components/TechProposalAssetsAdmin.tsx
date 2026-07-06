"use client";

import { useState } from "react";
import type { AppSettings } from "@/lib/settings";
import { DEFAULT_TECH_PROPOSAL_ASSETS } from "@/lib/settings";
import EditableImage from "./EditableImage";

/**
 * Admin editor for the company-level images reused on every Technical Proposal.
 * Upload each once here; every proposal falls back to it when its own
 * per-proposal image is empty. Stored inline as compressed data URLs in the
 * global settings (same mechanism as the brand artwork). Project-specific
 * images (network/CCTV diagram, storage screenshot, note) stay per-proposal.
 */

const SLOTS: Array<{
  key: keyof AppSettings["techProposalAssets"];
  title: string;
  hint: string;
}> = [
  {
    key: "authorizedCert",
    title: "Authorized certificate",
    hint: "The company / authorized certificate image.",
  },
  {
    key: "teamCerts",
    title: "Team certificates",
    hint: "The team certificates collage.",
  },
  {
    key: "pmCert",
    title: "Project Manager certificate",
    hint: "The Project Manager's certificate image.",
  },
  {
    key: "references",
    title: "References",
    hint: "The MagicTech references image.",
  },
];

export default function TechProposalAssetsAdmin({
  initialSettings,
  readOnly = false,
}: {
  initialSettings: AppSettings;
  readOnly?: boolean;
}) {
  const [assets, setAssets] = useState({
    ...DEFAULT_TECH_PROPOSAL_ASSETS,
    ...initialSettings.techProposalAssets,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  function set(key: keyof typeof assets, value: string) {
    setAssets((a) => ({ ...a, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ techProposalAssets: assets }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMsg({ kind: "ok", text: "Saved. Every technical proposal now uses these images by default." });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-magic-ink">
          Technical Proposal assets
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-magic-ink/60">
          Upload the company-level images once here — every Technical Proposal
          shows them by default (a proposal can still override its own copy).
          The project-specific images (network / CCTV diagram, storage
          screenshot, supporting note) stay on each proposal.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {SLOTS.map((slot) => (
          <div
            key={slot.key}
            className="rounded-2xl border border-magic-border bg-white p-4"
          >
            <h3 className="text-sm font-bold text-magic-ink">{slot.title}</h3>
            <p className="mb-3 text-xs text-magic-ink/55">{slot.hint}</p>
            <EditableImage
              value={assets[slot.key] || ""}
              onChange={(next) => (readOnly ? undefined : set(slot.key, next))}
              placeholder={`Click to upload the ${slot.title.toLowerCase()}`}
              height="16rem"
            />
          </div>
        ))}
      </div>

      {msg && (
        <div
          className={`rounded-xl border px-3.5 py-2.5 text-sm font-medium ${
            msg.kind === "ok"
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-red-300 bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </div>
      )}

      {!readOnly && (
        <button
          onClick={() => void save()}
          disabled={saving}
          className="rounded-xl bg-magic-red px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-magic-red/90 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save proposal assets"}
        </button>
      )}
    </section>
  );
}
