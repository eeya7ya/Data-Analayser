"use client";

import { useState } from "react";
import type { AppSettings } from "@/lib/settings";

/**
 * Admin-only editor for the global presets applied to every printable
 * quotation. The form is seeded from the server-rendered row so there's
 * no loading flash on first paint.
 */
export default function AdminSettings({
  initialSettings,
}: {
  initialSettings: AppSettings;
}) {
  const [termsText, setTermsText] = useState(
    initialSettings.defaultTerms.join("\n"),
  );
  const [footerText, setFooterText] = useState(initialSettings.footerText);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      const defaultTerms = termsText
        .split("\n")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultTerms, footerText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      setStatus("Saved.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={save}
      className="rounded-2xl border border-magic-border bg-white p-5 space-y-5"
    >
      <div>
        <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">
          Default Terms &amp; Conditions
        </label>
        <p className="text-[11px] text-magic-ink/60 mb-2">
          One term per line. These seed every new quotation and replace the
          built-in default list. Existing saved quotations keep their own
          terms.
        </p>
        <textarea
          value={termsText}
          onChange={(e) => setTermsText(e.target.value)}
          rows={8}
          className="w-full rounded-md border border-magic-border px-3 py-2 text-sm font-mono"
          placeholder="Validity: 1 week from the date of the offer."
        />
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">
          Printable footer (company address line)
        </label>
        <p className="text-[11px] text-magic-ink/60 mb-2">
          Shown at the bottom of every printable quotation sheet. Plain text —
          use a single line, or include line breaks to stack it.
        </p>
        <textarea
          value={footerText}
          onChange={(e) => setFooterText(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
          placeholder="Address: …  Tel: …  Fax: …"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-magic-red text-white px-4 py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {status && <span className="text-xs text-green-700">{status}</span>}
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </form>
  );
}
