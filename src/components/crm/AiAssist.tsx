"use client";

import { useState } from "react";

type Action = "summary" | "next" | "draft";

const META: Record<Action, { url: string; label: string; result: "summary" | "recommendation" | "draft" }> = {
  summary: {
    url: "/api/crm/ai/summarize-contact",
    label: "Summarise",
    result: "summary",
  },
  next: {
    url: "/api/crm/ai/next-action",
    label: "Next action",
    result: "recommendation",
  },
  draft: {
    url: "/api/crm/ai/follow-up-draft",
    label: "Draft follow-up",
    result: "draft",
  },
};

export default function AiAssist({ contactId }: { contactId: number }) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [active, setActive] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(a: Action) {
    setBusy(a);
    setActive(a);
    setError(null);
    try {
      const res = await fetch(META[a].url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "request failed");
      setOutput((data as Record<string, string>)[META[a].result] ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase text-magic-ink/60 mb-3">AI assist</h2>
      <div className="rounded-2xl border border-magic-border bg-white p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(META) as Action[]).map((a) => (
            <button
              key={a}
              onClick={() => run(a)}
              disabled={busy !== null}
              className={
                "rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-60 " +
                (active === a
                  ? "bg-magic-red text-white"
                  : "border border-magic-border text-magic-ink/80 hover:bg-magic-soft")
              }
            >
              {busy === a ? "…" : META[a].label}
            </button>
          ))}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {output != null && (
          <pre className="whitespace-pre-wrap text-xs text-magic-ink/80 bg-magic-soft/40 rounded-md p-3 max-h-96 overflow-y-auto font-sans">
            {output}
          </pre>
        )}
        {output == null && !error && (
          <p className="text-[11px] text-magic-ink/50">
            Reuses the existing Groq client. No external CRM vendor.
          </p>
        )}
      </div>
    </div>
  );
}
