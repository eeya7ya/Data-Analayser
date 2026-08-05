/**
 * Shared Quote-to-Delivery pipeline logic — used by the board API and the AI
 * briefing endpoint so the two never disagree about what stage a deal is in or
 * what the next action should be.
 */

export type Stage =
  | "quoting"
  | "approved"
  | "won"
  | "held"
  | "execution"
  | "delivered"
  | "lost";

export const STAGES: Stage[] = [
  "quoting",
  "approved",
  "won",
  "held",
  "execution",
  "delivered",
  "lost",
];

export const STAGE_LABEL: Record<Stage, string> = {
  quoting: "Quoting",
  approved: "With client",
  won: "Won",
  held: "On hold",
  execution: "In Execution",
  delivered: "Completed",
  lost: "Lost",
};

// Win probability per stage, used for the weighted forecast. Terminal stages
// (delivered = booked, lost = dead) are excluded from the weighted total.
export const STAGE_PROBABILITY: Record<Stage, number> = {
  quoting: 0.25,
  approved: 0.55,
  won: 0.9,
  held: 0.9,
  execution: 0.97,
  delivered: 1,
  lost: 0,
};

// Grace period (days) a deal can sit in a stage before stall decay kicks in —
// mirrors the next-best-action attention thresholds. Terminal stages never decay.
export const STAGE_GRACE_DAYS: Record<Stage, number> = {
  quoting: 5,
  approved: 7,
  won: 5,
  held: 7,
  execution: 30,
  delivered: 100000,
  lost: 100000,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Phase 4 — dynamic win probability. Starts from the stage's base rate and
 * adjusts it per deal using observable signals, returning the probability plus
 * human-readable "drivers" so the score is always explainable:
 *
 *   • Stall decay — a deal sitting well past its stage's grace period is less
 *     likely to close (linear decay, capped at −40%).
 *   • Client track record — blend toward how this specific client has actually
 *     converted historically vs the overall baseline (±25%), but only when
 *     there's enough history to trust it.
 *
 * Deterministic and instant (no LLM per deal). When the historical inputs are
 * absent it cleanly falls back to the static stage base. This is the on-ramp to
 * a trained model once enough closed deals exist to fit real weights.
 */
export function winProbability(
  stage: Stage,
  ageDays: number,
  opts: {
    clientWinRate?: number | null;
    baselineWinRate?: number | null;
    clientSample?: number;
  } = {},
): { p: number; drivers: string[] } {
  if (stage === "delivered") return { p: 1, drivers: [] };
  if (stage === "lost") return { p: 0, drivers: [] };

  let p = STAGE_PROBABILITY[stage];
  const drivers: string[] = [];

  const grace = STAGE_GRACE_DAYS[stage];
  if (ageDays > grace) {
    const decay = clamp(((ageDays - grace) / 30) * 0.4, 0, 0.4);
    if (decay >= 0.05) {
      p *= 1 - decay;
      drivers.push(`stalled ${ageDays}d (−${Math.round(decay * 100)}%)`);
    }
  }

  const { clientWinRate, baselineWinRate, clientSample } = opts;
  if (
    clientWinRate != null &&
    baselineWinRate != null &&
    (clientSample ?? 0) >= 2
  ) {
    const lift = clamp(clientWinRate - baselineWinRate, -0.5, 0.5);
    const adj = 0.5 * lift; // ±25% at the extremes
    if (Math.abs(adj) >= 0.03) {
      p *= 1 + adj;
      drivers.push(
        `client wins ${Math.round(clientWinRate * 100)}% historically (${
          adj >= 0 ? "+" : "−"
        }${Math.round(Math.abs(adj) * 100)}%)`,
      );
    }
  }

  return { p: clamp(p, 0.02, 0.98), drivers };
}

export interface StageInputs {
  transferred_at: string | null;
  project_status: string | null;
  sales_outcome: string | null;
  rejected_at: string | null;
  approved_at: string | null;
  /** Presales → sales handoff. Once sent, the deal is with the client side
   *  and the salesperson can act on it — same standing as `approved_at`
   *  (which no current flow stamps on its own). Optional so legacy callers
   *  that don't select the column keep working. */
  sent_to_sales_at?: string | null;
  /** Sales "Mark as Completed" — terminal close without (or after) the
   *  projects handoff. Optional for legacy callers. */
  completed_at?: string | null;
}

/**
 * Derives the pipeline stage from the live workflow columns — there is no
 * stored "stage" field, so the board can never drift out of sync with reality.
 */
export function deriveStage(r: StageInputs): Stage {
  if (r.completed_at) return "delivered";
  if (r.transferred_at) {
    return r.project_status === "completed" ? "delivered" : "execution";
  }
  if (r.sales_outcome === "accepted") return "won";
  if (r.sales_outcome === "held") return "held";
  if (r.sales_outcome === "rejected") return "lost";
  if (r.rejected_at) return "lost";
  if (r.approved_at || r.sent_to_sales_at) return "approved";
  return "quoting";
}

/**
 * A quotation row as far as version lineage is concerned. Drafts (…D<n>) and
 * revisions (…R<n>) carry `parent_ref` = the ref of the quotation they branched
 * from; the original carries null.
 */
export interface LineageInputs {
  ref: string;
  parent_ref?: string | null;
  sales_outcome?: string | null;
  rejected_at?: string | null;
  transferred_at?: string | null;
  completed_at?: string | null;
  sent_to_sales_at?: string | null;
  age_anchor?: string | null;
}

/**
 * How far into the sales cycle one row has travelled:
 *   2 — sales decided on it (won / lost / held / in execution / closed)
 *   1 — handed to sales, awaiting their decision
 *   0 — still with presales
 */
function decisionDepth(r: LineageInputs): number {
  if (r.completed_at || r.transferred_at || r.sales_outcome || r.rejected_at) {
    return 2;
  }
  return r.sent_to_sales_at ? 1 : 0;
}

/** Newest timestamp known for a row — breaks ties at equal depth. */
function rowRecency(r: LineageInputs): number {
  let newest = 0;
  for (const s of [r.age_anchor, r.sent_to_sales_at]) {
    if (!s) continue;
    const t = new Date(s).getTime();
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  return newest;
}

/**
 * Collapse every version of one quotation number down to a single deal.
 *
 * A quotation, its drafts and its revisions are ONE deal — the client signs
 * exactly one of them. Presales may hand any version to sales, and that version
 * then walks the full cycle, so the row that represents the deal is the one the
 * sales side last acted on: deepest into the cycle first (a decided revision
 * beats an untouched original), newest activity as the tie-break (a freshly
 * sent revision beats the version it supersedes).
 *
 * Callers pass originals plus the snapshots that were actually sent to sales;
 * with no snapshots in play this is a pass-through, so plain quotations behave
 * exactly as they did when the boards simply filtered `parent_ref is null`.
 */
export function collapseVersions<T extends LineageInputs>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const key = row.parent_ref ?? row.ref;
    const current = best.get(key);
    if (!current) {
      best.set(key, row);
      continue;
    }
    const depth = decisionDepth(row);
    const currentDepth = decisionDepth(current);
    if (
      depth > currentDepth ||
      (depth === currentDepth && rowRecency(row) > rowRecency(current))
    ) {
      best.set(key, row);
    }
  }
  return [...best.values()];
}

/**
 * Deterministic next-best-action + stall risk per deal. No AI cost: the move
 * and the "needs attention" flag fall out of the stage and how long the deal
 * has sat there.
 */
export function insight(
  stage: Stage,
  ageDays: number,
): { action: string; attention: boolean } {
  switch (stage) {
    case "quoting":
      return {
        action: ageDays >= 5 ? "Chase internal sign-off" : "Awaiting approval",
        attention: ageDays >= 5,
      };
    case "approved":
      return {
        action:
          ageDays >= 7
            ? "Follow up with the client"
            : "Awaiting client decision",
        attention: ageDays >= 7,
      };
    case "won":
      return { action: "Confirm PO & hand off", attention: ageDays >= 5 };
    case "held":
      return { action: "Schedule handoff to projects", attention: ageDays >= 7 };
    case "execution":
      return { action: "Track delivery", attention: false };
    case "delivered":
      return { action: "Close & collect", attention: false };
    case "lost":
      return { action: "", attention: false };
  }
}
