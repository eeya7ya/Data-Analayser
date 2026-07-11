"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  FileText,
  Send,
  Trophy,
  PauseCircle,
  HardHat,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Layers,
  Wallet,
  Coins,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import Spinner from "@/components/Spinner";
import PageLoader from "@/components/PageLoader";
import { type Stage, STAGE_PROBABILITY } from "@/lib/pipeline";

/**
 * Quote-to-Delivery pipeline — a single Kanban spanning the sale AND the
 * delivery, priced with each quotation's real BoQ total. Two things put it
 * above a generic CRM:
 *   1. Deal value is the engineered BoQ total, not a guess.
 *   2. The weighted forecast = Σ(BoQ value × stage probability).
 *
 * Stages are derived server-side from the live workflow columns, so the board
 * always reflects reality. The one manual decision — the client outcome on an
 * Approved deal (Won / Held / Lost) — is actionable here, by buttons or by
 * dragging the card into the Won / Held / Lost column.
 */

interface DealCard {
  id: number;
  ref: string;
  projectName: string | null;
  clientName: string | null;
  ownerName: string | null;
  value: number;
  stage: Stage;
  probability: number;
  probabilityDrivers: string[];
  ageDays: number;
  action: string;
  attention: boolean;
  grossProfit: number;
  marginPct: number | null;
  markupPct: number | null;
  coverage: number;
}

interface BoardData {
  columns: Record<Stage, DealCard[]>;
  counts: Record<Stage, number>;
  metrics: {
    openValue: number;
    committedValue: number;
    deliveryValue: number;
    wonValue: number;
    weightedForecast: number;
    weightedGrossProfit: number;
    blendedMarginPct: number | null;
    markupPct: number | null;
    marginCoverage: number | null;
    winRate: number | null;
    leadsOpen: number;
    attentionCount: number;
    totalDeals: number;
  };
}

const COLUMNS: {
  key: Stage;
  label: string;
  icon: typeof FileText;
  accent: string;
}[] = [
  { key: "quoting", label: "Quoting", icon: FileText, accent: "text-slate-500" },
  { key: "approved", label: "With client", icon: Send, accent: "text-sky-600" },
  { key: "won", label: "Won", icon: Trophy, accent: "text-emerald-600" },
  { key: "held", label: "On hold", icon: PauseCircle, accent: "text-magic-red" },
  { key: "execution", label: "In Execution", icon: HardHat, accent: "text-violet-600" },
  { key: "delivered", label: "Completed", icon: CheckCircle2, accent: "text-emerald-700" },
  { key: "lost", label: "Lost", icon: XCircle, accent: "text-amber-600" },
];

// Dragging an Approved card onto one of these columns records the outcome.
const DROP_OUTCOME: Partial<Record<Stage, "accepted" | "held" | "rejected">> = {
  won: "accepted",
  held: "held",
  lost: "rejected",
};

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    Math.round(n || 0),
  );
}

function columnValue(cards: DealCard[]): number {
  return cards.reduce((a, c) => a + c.value, 0);
}

// Average dynamic win probability of a column, falling back to the stage base
// when the column is empty.
function avgProbability(cards: DealCard[], stage: Stage): number {
  if (cards.length === 0) return STAGE_PROBABILITY[stage];
  return cards.reduce((a, c) => a + c.probability, 0) / cards.length;
}

// Colour the per-deal SI-markup badge. The SI base price already carries a
// healthy margin, so selling AT SI base (0% markup) is normal business — only
// pricing BELOW the SI base is flagged red. Everything else is neutral/green.
function markupTone(pct: number): string {
  if (pct < 0) return "bg-red-100 text-red-700";
  if (pct === 0) return "bg-slate-100 text-slate-600";
  return "bg-emerald-100 text-emerald-700";
}

export default function PipelineBoardClient({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<Stage | null>(null);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingBusy, setBriefingBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/crm/pipeline-board", { cache: "no-store" });
      const d = (await r.json()) as BoardData & { error?: string };
      if (d.error) setError(d.error);
      else {
        setData(d);
        setError(null);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markOutcome = useCallback(
    async (id: number, outcome: "accepted" | "held" | "rejected") => {
      let reason: string | null = null;
      if (outcome === "rejected") {
        reason = window.prompt(
          "Mark this deal LOST — a reason is required (client passed, lost to a competitor, budget, …):",
        );
        if (reason === null) return; // cancelled
        if (!reason.trim()) {
          window.alert("A reason is required to mark the deal as lost.");
          return;
        }
        reason = reason.trim();
      }
      setBusyId(id);
      try {
        const r = await fetch("/api/quotations/outcome", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, outcome, reason }),
        });
        const d = (await r.json()) as { error?: string };
        if (!r.ok || d.error) {
          window.alert(d.error || "Could not update the deal.");
        } else {
          await load();
        }
      } catch (e) {
        window.alert((e as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const runBriefing = useCallback(async () => {
    setBriefingBusy(true);
    setBriefing(null);
    try {
      const r = await fetch("/api/crm/pipeline-board/briefing", {
        method: "POST",
      });
      const d = (await r.json()) as { briefing?: string | null; error?: string };
      setBriefing(d.briefing || d.error || "No briefing returned.");
    } catch (e) {
      setBriefing((e as Error).message);
    } finally {
      setBriefingBusy(false);
    }
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }
  if (!data) {
    // The board client-fetches its deals + margins after mount; a bare 16px
    // spinner on this full-width canvas read as a broken/empty page. Use the
    // brand heartbeat loader at full size with a label so it clearly reads as
    // "loading", matching every other route in the app.
    return <PageLoader fullScreen label="Loading your pipeline…" />;
  }

  const m = data.metrics;

  return (
    <div className="space-y-5">
      {/* Headline numbers — four plain-language KPIs that answer, in order:
          what's in play, what will it likely bring in, what have I won, and
          what's already delivered. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={Layers}
          label="Open deals"
          value={fmtMoney(m.openValue)}
          hint={`${data.counts.quoting + data.counts.approved} deal${
            data.counts.quoting + data.counts.approved === 1 ? "" : "s"
          } awaiting a decision`}
          highlight
        />
        <Kpi
          icon={TrendingUp}
          label="Expected to close"
          value={fmtMoney(m.weightedForecast)}
          hint="each deal's value × its win chance"
        />
        <Kpi
          icon={Trophy}
          label="Won & on hold"
          value={fmtMoney(m.committedValue)}
          hint={`${data.counts.won + data.counts.held} deal${
            data.counts.won + data.counts.held === 1 ? "" : "s"
          } ready for delivery / execution`}
        />
        <Kpi
          icon={Wallet}
          label="In execution & completed"
          value={fmtMoney(m.deliveryValue)}
          hint={`${data.counts.execution + data.counts.delivered} deal${
            data.counts.execution + data.counts.delivered === 1 ? "" : "s"
          } being delivered or done`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-magic-ink/60">
        <Link
          href="/leads"
          className="rounded-full border border-magic-border bg-white px-3 py-1 font-semibold hover:text-magic-red"
        >
          {m.leadsOpen} open lead{m.leadsOpen === 1 ? "" : "s"} →
        </Link>
        {m.winRate !== null && (
          <span className="rounded-full border border-magic-border bg-white px-3 py-1 font-semibold">
            Win rate {m.winRate}%
          </span>
        )}
        {m.attentionCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 font-semibold text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            {m.attentionCount} need attention
          </span>
        )}
        {m.markupPct !== null && (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 font-semibold ${
              m.markupPct < 0
                ? "border-red-300 bg-red-50 text-red-700"
                : "border-magic-border bg-white"
            }`}
            title={`How far above the System-Installer base price the pipeline is sold${
              m.marginCoverage !== null && m.marginCoverage < 100
                ? ` (based on the ${m.marginCoverage}% of value that carries an SI price)`
                : ""
            }. The SI base already includes a healthy margin, so 0% is not a loss.`}
          >
            <Coins className="h-3.5 w-3.5" />
            {m.markupPct >= 0 ? "+" : ""}
            {m.markupPct}% over SI base
          </span>
        )}
        <span className="rounded-full border border-magic-border bg-white px-3 py-1">
          {m.totalDeals} live deals
        </span>
        {readOnly && (
          <span className="rounded-full border border-magic-border bg-magic-soft px-3 py-1 font-semibold text-magic-ink/60">
            Read-only
          </span>
        )}
        <button
          onClick={runBriefing}
          disabled={briefingBusy}
          className="inline-flex items-center gap-1.5 rounded-full bg-magic-red px-3 py-1 font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {briefingBusy ? "Briefing…" : "AI briefing"}
        </button>
      </div>

      {(briefingBusy || briefing) && (
        <div className="rounded-2xl border border-magic-red/30 bg-magic-red/5 p-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-magic-red">
            <Sparkles className="h-4 w-4" />
            AI pipeline briefing
          </div>
          {briefingBusy ? (
            <div className="flex items-center gap-2 text-sm text-magic-ink/55">
              <Spinner /> Reading your pipeline…
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-magic-ink/80">
              {briefing}
            </p>
          )}
        </div>
      )}

      {/* Kanban */}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {COLUMNS.map((col) => {
          const cards = data.columns[col.key];
          const Icon = col.icon;
          const isTarget = !readOnly && DROP_OUTCOME[col.key] !== undefined;
          const active = dragOver === col.key && isTarget && dragId !== null;
          return (
            <div
              key={col.key}
              onDragOver={(e) => {
                if (isTarget && dragId !== null) {
                  e.preventDefault();
                  setDragOver(col.key);
                }
              }}
              onDragLeave={() => setDragOver((s) => (s === col.key ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                const outcome = DROP_OUTCOME[col.key];
                if (outcome && dragId !== null) void markOutcome(dragId, outcome);
                setDragId(null);
                setDragOver(null);
              }}
              className={`flex w-72 shrink-0 flex-col rounded-2xl border bg-magic-soft/40 p-2 transition-colors ${
                active
                  ? "border-magic-red bg-magic-red/5"
                  : "border-magic-border"
              }`}
            >
              <div className="flex items-center justify-between px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <Icon className={`h-4 w-4 ${col.accent}`} />
                  <span className="text-sm font-semibold text-magic-ink">
                    {col.label}
                  </span>
                </div>
                <span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] font-bold text-magic-ink/70">
                  {cards.length}
                </span>
              </div>
              <div className="px-2 pb-1 text-[11px] font-medium text-magic-ink/45">
                {col.key === "lost"
                  ? "—"
                  : `${fmtMoney(columnValue(cards))} · ${Math.round(
                      avgProbability(cards, col.key) * 100,
                    )}% win chance`}
              </div>

              <div className="flex flex-1 flex-col gap-2 px-0.5 pt-1">
                {cards.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-magic-border/70 px-3 py-6 text-center text-[11px] text-magic-ink/40">
                    Empty
                  </div>
                ) : (
                  cards.map((card) => {
                    // Approved deals get the full Won / Hold / Lost call; a
                    // held deal can still be decided later (Won / Lost).
                    const decidable =
                      card.stage === "approved" || card.stage === "held";
                    const draggable = !readOnly && decidable;
                    return (
                      <div
                        key={card.id}
                        draggable={draggable}
                        onDragStart={() => draggable && setDragId(card.id)}
                        onDragEnd={() => {
                          setDragId(null);
                          setDragOver(null);
                        }}
                        className={`rounded-xl border border-magic-border bg-white px-3 py-2 shadow-mt-soft transition-shadow hover:shadow-mt-lift ${
                          card.attention ? "border-l-4 border-l-amber-400" : ""
                        } ${
                          draggable ? "cursor-grab active:cursor-grabbing" : ""
                        } ${busyId === card.id ? "opacity-50" : ""}`}
                      >
                        <Link
                          href={`/quotation?id=${card.id}`}
                          className="block truncate text-sm font-semibold text-magic-ink hover:text-magic-red"
                        >
                          {card.projectName || card.ref}
                        </Link>
                        <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-magic-ink/55">
                          <span className="truncate">
                            {card.clientName || card.ownerName || card.ref}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            {card.markupPct !== null && (
                              <span
                                className={`rounded px-1 py-0.5 text-[9px] font-bold ${markupTone(
                                  card.markupPct,
                                )}`}
                                title={`Priced ${
                                  card.markupPct >= 0
                                    ? `${card.markupPct}% above`
                                    : `${Math.abs(card.markupPct)}% BELOW`
                                } the SI base price${
                                  card.coverage < 0.8
                                    ? ` (SI price on ${Math.round(
                                        card.coverage * 100,
                                      )}% of lines)`
                                    : ""
                                }. The SI base already includes margin.`}
                              >
                                {card.coverage < 0.8 ? "~" : ""}
                                {card.markupPct >= 0 ? "+" : ""}
                                {card.markupPct}% SI
                              </span>
                            )}
                            <span className="font-semibold text-magic-ink/80">
                              {card.value > 0 ? fmtMoney(card.value) : "—"}
                            </span>
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[10px] text-magic-ink/40">
                          <span className="font-mono">{card.ref}</span>
                          <span className="flex items-center gap-1.5">
                            {card.stage !== "lost" &&
                              card.stage !== "delivered" && (
                                <span
                                  className={`font-semibold text-magic-ink/55 ${
                                    card.probabilityDrivers.length
                                      ? "underline decoration-dotted underline-offset-2"
                                      : ""
                                  }`}
                                  title={
                                    card.probabilityDrivers.length
                                      ? `Win probability — ${card.probabilityDrivers.join(
                                          "; ",
                                        )}`
                                      : "Win probability (stage base — no deal-specific signals yet)"
                                  }
                                >
                                  {Math.round(card.probability * 100)}%
                                </span>
                              )}
                            {card.ageDays > 0 && (
                              <span
                                className={
                                  card.ageDays >= 7 &&
                                  (card.stage === "quoting" ||
                                    card.stage === "approved")
                                    ? "font-semibold text-amber-600"
                                    : ""
                                }
                              >
                                {card.ageDays}d
                              </span>
                            )}
                          </span>
                        </div>

                        {card.attention && card.action && (
                          <div className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-amber-600">
                            <AlertTriangle className="h-3 w-3" />
                            {card.action}
                          </div>
                        )}

                        {decidable && !readOnly && (
                          <div className="mt-2 flex gap-1">
                            <button
                              disabled={busyId === card.id}
                              onClick={() => markOutcome(card.id, "accepted")}
                              title="The client accepted — mark this deal Won"
                              className="flex-1 rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Win ✓
                            </button>
                            {card.stage === "approved" && (
                              <button
                                disabled={busyId === card.id}
                                onClick={() => markOutcome(card.id, "held")}
                                title="No decision yet — put this lead on hold"
                                className="flex-1 rounded-lg bg-magic-red px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                              >
                                Hold
                              </button>
                            )}
                            <button
                              disabled={busyId === card.id}
                              onClick={() => markOutcome(card.id, "rejected")}
                              title="The client passed — record why and mark it Lost"
                              className="flex-1 rounded-lg border border-magic-border bg-white px-2 py-1 text-[11px] font-semibold text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50"
                            >
                              Lost
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  highlight,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  hint: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-3.5 ${
        highlight
          ? "border-magic-red/30 bg-magic-red/5"
          : "border-magic-border bg-white"
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-magic-ink/60">
        <Icon className={`h-4 w-4 ${highlight ? "text-magic-red" : ""}`} />
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-magic-ink">{value}</div>
      <div className="mt-0.5 text-[11px] text-magic-ink/45">{hint}</div>
    </div>
  );
}
