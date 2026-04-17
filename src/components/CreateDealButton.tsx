"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Single-click "Create deal" action attached to every quotation row.
 *
 * Posts to /api/crm/deals with just `{ title, quotation_id }` — the server
 * (src/app/api/crm/deals/route.ts) reads the quotation and auto-populates
 * company_id / contact_id / folder_id / amount / currency from the linked
 * CRM company. The deal is created in the user's default pipeline's first
 * stage (the kanban's leftmost column).
 *
 * On success we navigate straight to /crm/deals so the user sees the new
 * card; on CRM-disabled / CRM errors we stay put and surface the message
 * inline so they can retry or flip the feature flag on.
 */
export default function CreateDealButton({
  quotationId,
  quotationRef,
  projectName,
  label,
  className,
}: {
  quotationId: number;
  quotationRef: string;
  projectName: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handle() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      // Pick (or create) the user's default pipeline so the deal lands in a
      // visible stage on the kanban. /api/crm/pipelines returns everything
      // we need.
      const pRes = await fetch("/api/crm/pipelines", {
        credentials: "include",
      });
      if (!pRes.ok) {
        const body = await pRes.json().catch(() => ({}));
        throw new Error(
          body.error === "CRM_DISABLED"
            ? "CRM is disabled. Enable it from the admin Settings page."
            : body.error || `Pipelines lookup failed (${pRes.status})`,
        );
      }
      const p = (await pRes.json()) as {
        pipelines?: Array<{ id: number; is_default?: boolean }>;
        stages?: Array<{ id: number; pipeline_id: number; position: number }>;
      };
      const pipeline =
        (p.pipelines ?? []).find((pl) => pl.is_default) ?? p.pipelines?.[0];
      const stage = pipeline
        ? (p.stages ?? [])
            .filter((s) => s.pipeline_id === pipeline.id)
            .sort((a, b) => a.position - b.position)[0]
        : null;

      const title =
        `${projectName || "Quotation"} — ${quotationRef}`.slice(0, 200);
      const res = await fetch("/api/crm/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title,
          quotation_id: quotationId,
          pipeline_id: pipeline?.id ?? null,
          stage_id: stage?.id ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Create deal failed (${res.status})`);
      }
      router.push("/crm/deals");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={handle}
        disabled={busy}
        title={err ?? "Create a CRM deal from this quotation"}
        className={
          className ??
          "text-xs font-semibold text-magic-ink/70 hover:text-magic-red hover:underline disabled:opacity-50"
        }
      >
        {busy ? "…" : label ?? "+ Deal"}
      </button>
      {err ? (
        <span className="text-[10px] text-red-600" title={err}>
          !
        </span>
      ) : null}
    </span>
  );
}
