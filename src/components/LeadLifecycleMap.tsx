"use client";

/**
 * Lead lifecycle map (V1.8).
 *
 * A per-lead stepper that reads the timestamps already stored on the lead
 * (created → claimed by presales → quotation sent → sales decision → BOQ →
 * sent to execution → completed) and renders each step as done / current /
 * upcoming, WITH the elapsed time between steps. The point is to see, at a
 * glance, exactly where a lead is stuck: the current (first not-yet-done) step
 * shows how long it has been waiting, so a delay in, say, quotation design is
 * obvious instead of buried in the activity log.
 *
 * Pure presentation — every value comes from the lead row the detail page
 * already loads; this component computes nothing server-side.
 */

interface LifecycleLead {
  created_at: string;
  created_by_name: string | null;
  created_by_username: string | null;
  assigned_at: string | null;
  assigned_to_name: string | null;
  assigned_to_username: string | null;
  quotation_sent_at: string | null;
  quotation_ref: string | null;
  outcome: string | null;
  outcome_at: string | null;
  outcome_by_username: string | null;
  boq_uploaded_at: string | null;
  boq_filename: string | null;
  sent_to_execution_at: string | null;
  execution_assignee_name: string | null;
  execution_assignee_username: string | null;
  completed_at: string | null;
}

interface Step {
  key: string;
  label: string;
  /** When this step happened, or null if it hasn't yet. */
  at: string | null;
  /** Who owns / owned this step (name shown under the label). */
  who?: string | null;
  /** Extra one-line context (e.g. the quotation ref). */
  detail?: string | null;
  /** False when the step doesn't apply to this lead's path (e.g. execution
   *  steps after a lost deal) — rendered muted and never counted as pending. */
  relevant: boolean;
}

/** Human elapsed between two instants, e.g. "2d 4h", "3h 10m", "just now". */
function humanGap(fromISO: string, toMs: number): string {
  const from = new Date(fromISO).getTime();
  if (Number.isNaN(from)) return "";
  let s = Math.max(0, Math.floor((toMs - from) / 1000));
  if (s < 60) return "just now";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

function isLost(outcome: string | null): boolean {
  if (!outcome) return false;
  return /reject|lost|declin|cancel/i.test(outcome);
}

export default function LeadLifecycleMap({ lead }: { lead: LifecycleLead }) {
  const now = Date.now();
  const lost = isLost(lead.outcome);
  const won = Boolean(lead.outcome_at) && !lost;

  const decisionLabel = lead.outcome_at
    ? lost
      ? "Sales decision — Lost"
      : "Sales decision — Won"
    : "Sales decision";

  const steps: Step[] = [
    {
      key: "created",
      label: "Lead sent",
      at: lead.created_at,
      who: lead.created_by_name || lead.created_by_username,
      relevant: true,
    },
    {
      key: "claimed",
      label: "Received by presales",
      at: lead.assigned_at,
      who: lead.assigned_to_name || lead.assigned_to_username,
      relevant: true,
    },
    {
      key: "quotation",
      label: "Quotation designed & sent",
      at: lead.quotation_sent_at,
      detail: lead.quotation_ref,
      relevant: true,
    },
    {
      key: "decision",
      label: decisionLabel,
      at: lead.outcome_at,
      who: lead.outcome_by_username,
      relevant: true,
    },
    // Post-win execution chain — only applies when the deal was won.
    {
      key: "boq",
      label: "BOQ uploaded",
      at: lead.boq_uploaded_at,
      detail: lead.boq_filename,
      relevant: !lost,
    },
    {
      key: "execution",
      label: "Sent to execution",
      at: lead.sent_to_execution_at,
      who: lead.execution_assignee_name || lead.execution_assignee_username,
      relevant: !lost,
    },
    {
      key: "completed",
      label: "Completed",
      at: lead.completed_at,
      relevant: !lost,
    },
  ];

  // The current step = the first relevant step that hasn't happened. A lost
  // deal is terminal at the decision, so nothing is "current" after it.
  const currentIdx =
    lost && lead.outcome_at
      ? -1
      : steps.findIndex((s) => s.relevant && !s.at);

  // Timestamp of the most recent completed step, to measure how long the
  // current step has been waiting.
  const lastDoneAt = [...steps]
    .filter((s) => s.at)
    .map((s) => s.at as string)
    .sort()
    .at(-1);

  return (
    <div className="rounded-2xl border border-magic-border bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-magic-ink/70">
          Lifecycle
        </h3>
        <span className="text-[11px] text-magic-ink/40">
          {steps.filter((s) => s.relevant && s.at).length}/
          {steps.filter((s) => s.relevant).length} steps done
        </span>
      </div>

      <ol className="relative space-y-4 border-l border-magic-border/60 pl-5">
        {steps.map((step, idx) => {
          const done = Boolean(step.at);
          const isCurrent = idx === currentIdx;
          const muted = !step.relevant;
          // Gap from the previous done step to this one (done steps) or to now
          // (the current, still-waiting step) — this is the "where's the delay"
          // signal.
          const prevDoneAt = steps
            .slice(0, idx)
            .filter((s) => s.at)
            .map((s) => s.at as string)
            .sort()
            .at(-1);
          const gap = done
            ? prevDoneAt
              ? humanGap(prevDoneAt, new Date(step.at as string).getTime())
              : null
            : isCurrent && lastDoneAt
              ? humanGap(lastDoneAt, now)
              : null;

          const dot = muted
            ? "bg-magic-ink/20"
            : done
              ? "bg-emerald-500"
              : isCurrent
                ? "bg-amber-500"
                : "bg-magic-ink/25";

          return (
            <li key={step.key} className="relative">
              <span
                className={`absolute -left-[1.6rem] top-1 h-3 w-3 rounded-full ring-4 ring-white ${dot}`}
              />
              <div className="flex flex-wrap items-baseline gap-2">
                <span
                  className={`text-xs font-semibold uppercase tracking-wide ${
                    muted
                      ? "text-magic-ink/30"
                      : done
                        ? "text-magic-ink/75"
                        : isCurrent
                          ? "text-amber-700"
                          : "text-magic-ink/40"
                  }`}
                >
                  {step.label}
                </span>
                {done && (
                  <span className="text-[11px] text-magic-ink/40">
                    {new Date(step.at as string).toLocaleString()}
                  </span>
                )}
                {done && gap && (
                  <span className="text-[11px] text-magic-ink/40">
                    · {gap} after previous
                  </span>
                )}
                {isCurrent && (
                  <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                    {gap ? `waiting ${gap}` : "waiting"}
                  </span>
                )}
              </div>
              {(step.who || step.detail) && !muted && (
                <p className="mt-0.5 text-[11px] text-magic-ink/45">
                  {[step.who, step.detail].filter(Boolean).join(" · ")}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {lost && lead.outcome_at && (
        <p className="mt-4 rounded-lg border border-dashed border-magic-border/70 px-3 py-2 text-[11px] text-magic-ink/50">
          This lead was lost at the sales decision — the execution steps don&apos;t
          apply.
        </p>
      )}
      {won && !lead.completed_at && (
        <p className="mt-4 text-[11px] text-magic-ink/40">
          Won — tracking through execution.
        </p>
      )}
    </div>
  );
}
