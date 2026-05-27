"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trophy, XCircle, Clock } from "lucide-react";
import Spinner from "@/components/Spinner";

/**
 * V1.3D — Sales pipeline. Three buckets derived from each quotation's
 * client outcome:
 *
 *   • Held  — Held for Execution, not yet transferred to projects.
 *   • Won   — client accepted, or already transferred to projects.
 *   • Lost  — client rejected.
 *
 * Fetching the list runs the server-side hold sweep, so opening this page
 * is also what fires any overdue auto-transfers.
 */

interface PipelineRow {
  id: number;
  ref: string;
  project_name: string | null;
  client_name: string | null;
  folder_id: number | null;
  sales_outcome: string | null;
  sales_outcome_at: string | null;
  hold_transfer_at: string | null;
  transferred_at: string | null;
  total: string | null;
}

interface PipelineData {
  held: PipelineRow[];
  won: PipelineRow[];
  lost: PipelineRow[];
  counts: { held: number; won: number; lost: number };
}

type Bucket = "held" | "won" | "lost";

const TABS: { id: Bucket; label: string; icon: typeof Clock; tone: string }[] = [
  { id: "held", label: "Held", icon: Clock, tone: "text-magic-red" },
  { id: "won", label: "Won", icon: Trophy, tone: "text-emerald-600" },
  { id: "lost", label: "Lost", icon: XCircle, tone: "text-amber-600" },
];

export default function SalesPipelineClient({
  initialBucket,
}: {
  initialBucket?: string | null;
}) {
  const [data, setData] = useState<PipelineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Bucket>(
    initialBucket === "won" || initialBucket === "lost" ? initialBucket : "held",
  );

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/crm/pipeline", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: PipelineData & { error?: string }) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }

  const rows = data[tab];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-magic-border bg-white/70 p-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                active
                  ? "bg-magic-red text-white shadow-sm"
                  : "text-magic-ink/70 hover:bg-magic-soft hover:text-magic-ink"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              <span
                className={`ml-1 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                  active ? "bg-white/20" : "bg-magic-soft"
                }`}
              >
                {data.counts[t.id]}
              </span>
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-magic-border bg-white p-10 text-center text-sm text-magic-ink/55">
          Nothing in <span className="font-semibold">{tab}</span> yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-magic-border bg-white px-4 py-3 shadow-mt-soft transition-shadow hover:shadow-mt-lift"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/quotation?id=${r.id}`}
                    className="font-semibold text-magic-ink hover:text-magic-red"
                  >
                    {r.project_name || r.ref}
                  </Link>
                  <div className="mt-0.5 text-xs text-magic-ink/55">
                    <span className="font-mono">{r.ref}</span>
                    {r.client_name && <> · {r.client_name}</>}
                    {r.sales_outcome_at && (
                      <> · {new Date(r.sales_outcome_at).toLocaleDateString()}</>
                    )}
                  </div>
                </div>
                <div className="text-right text-xs">
                  {tab === "held" && (
                    <span className="text-magic-ink/60">
                      {r.hold_transfer_at
                        ? `auto-transfers ${new Date(r.hold_transfer_at).toLocaleString()}`
                        : "manual transfer"}
                    </span>
                  )}
                  {tab === "won" && r.transferred_at && (
                    <span className="text-emerald-700">in execution</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
