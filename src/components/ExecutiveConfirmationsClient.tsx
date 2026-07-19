"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, Clock, FileText, Tags } from "@/lib/icons";

export interface ExecItem {
  id: number;
  exec_status: "pending" | "confirmed" | "rejected" | "none";
  exec_submitted_at: string | null;
  exec_decided_at: string | null;
  exec_reject_reason: string | null;
  submitted_by: string | null;
  owner: string | null;
  // quotation-only
  ref?: string;
  project_name?: string;
  client_name?: string | null;
  // pricing-only
  name?: string;
  manufacturer?: string | null;
}

type ItemType = "quotation" | "pricing";

/**
 * Executive-manager confirmations queue. Two lists — quotations and pricing
 * sheets — each showing pending items (with Confirm / Reject) above already
 * decided ones. Actions are optimistic and revert on error.
 */
export default function ExecutiveConfirmationsClient({
  initialQuotations,
  initialPricing,
}: {
  initialQuotations: ExecItem[];
  initialPricing: ExecItem[];
}) {
  const [quotations, setQuotations] = useState(initialQuotations);
  const [pricing, setPricing] = useState(initialPricing);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(
    type: ItemType,
    item: ExecItem,
    action: "confirm" | "reject",
  ) {
    let reason: string | null = null;
    if (action === "reject") {
      reason = window.prompt(
        "Reject — give a brief reason the submitter will see:",
      );
      if (reason === null) return;
      if (!reason.trim()) {
        setError("A reason is required to reject.");
        return;
      }
    }
    const key = `${type}:${item.id}`;
    setBusy(key);
    setError(null);
    const next = action === "confirm" ? "confirmed" : "rejected";
    const apply = (list: ExecItem[]) =>
      list.map((x) =>
        x.id === item.id
          ? {
              ...x,
              exec_status: next as ExecItem["exec_status"],
              exec_reject_reason: reason,
              exec_decided_at: new Date().toISOString(),
            }
          : x,
      );
    const set = type === "quotation" ? setQuotations : setPricing;
    const prev = type === "quotation" ? quotations : pricing;
    set(apply(prev));
    try {
      const res = await fetch("/api/executive/confirmations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id: item.id, action, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
    } catch (err) {
      set(prev); // revert
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const pendingCount =
    quotations.filter((q) => q.exec_status === "pending").length +
    pricing.filter((p) => p.exec_status === "pending").length;

  return (
    <div className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700"
        >
          {error}
        </div>
      )}

      <p className="text-sm text-magic-ink/60">
        {pendingCount === 0
          ? "Nothing awaiting your confirmation right now."
          : `${pendingCount} item${pendingCount === 1 ? "" : "s"} awaiting your confirmation.`}
      </p>

      <Section
        icon={FileText}
        title="Quotations"
        items={quotations}
        busy={busy}
        onDecide={(item, action) => decide("quotation", item, action)}
        primary={(i) => i.ref || `Quotation #${i.id}`}
        secondary={(i) =>
          [i.project_name, i.client_name].filter(Boolean).join(" · ")
        }
      />

      <Section
        icon={Tags}
        title="Pricing sheets"
        items={pricing}
        busy={busy}
        onDecide={(item, action) => decide("pricing", item, action)}
        primary={(i) => i.name || `Sheet #${i.id}`}
        secondary={(i) => i.manufacturer || ""}
      />
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  items,
  busy,
  onDecide,
  primary,
  secondary,
}: {
  icon: typeof FileText;
  title: string;
  items: ExecItem[];
  busy: string | null;
  onDecide: (item: ExecItem, action: "confirm" | "reject") => void;
  primary: (i: ExecItem) => string;
  secondary: (i: ExecItem) => string;
}) {
  const pending = items.filter((i) => i.exec_status === "pending");
  const decided = items.filter((i) => i.exec_status !== "pending");
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-magic-ink/50" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-magic-ink/60">
          {title}
        </h2>
        <span className="inline-flex items-center rounded-full bg-magic-soft px-2 py-0.5 text-xs font-semibold text-magic-ink/60">
          {pending.length} pending
        </span>
        <span className="h-px flex-1 bg-magic-border/70" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-magic-border bg-white shadow-mt-soft">
        {items.length === 0 ? (
          <p className="p-5 text-center text-sm text-magic-ink/50">None yet.</p>
        ) : (
          <ul className="divide-y divide-magic-border">
            {[...pending, ...decided].map((i) => {
              const key = `${title}:${i.id}`;
              const isBusy =
                busy === `quotation:${i.id}` || busy === `pricing:${i.id}`;
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-magic-ink">
                      {primary(i)}
                    </p>
                    <p className="truncate text-xs text-magic-ink/50">
                      {secondary(i)}
                      {i.submitted_by && ` · from @${i.submitted_by}`}
                    </p>
                    {i.exec_status === "rejected" && i.exec_reject_reason && (
                      <p className="mt-0.5 text-xs text-amber-700">
                        Rejected: {i.exec_reject_reason}
                      </p>
                    )}
                  </div>

                  {i.exec_status === "pending" ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onDecide(i, "confirm")}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Confirm
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onDecide(i, "reject")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-50"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Reject
                      </button>
                    </div>
                  ) : (
                    <StatusPill status={i.exec_status} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: ExecItem["exec_status"] }) {
  if (status === "confirmed") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" /> Confirmed
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
        <XCircle className="h-3.5 w-3.5" /> Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-magic-soft px-2.5 py-1 text-xs font-semibold text-magic-ink/60">
      <Clock className="h-3.5 w-3.5" /> Pending
    </span>
  );
}
