"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  type LucideIcon,
} from "lucide-react";

/**
 * Project-manager execution roll-up for the dashboard. Two things the PM
 * asked for, in one place:
 *
 *   - "project executive completion" — a completion % per project, derived
 *     from execution reports (latest progress, 100 once a `done` lands).
 *   - "daily / weekly / monthly reports … one report from all today's
 *     projects" — every execution report in the chosen period across the
 *     whole portfolio, grouped by project. Today's tab IS the all-day
 *     single report.
 *
 * Self-contained: fetches /api/execution-reports/summary and re-fetches when
 * the period tab changes. Scope is enforced server-side.
 */

type Period = "today" | "week" | "month";

interface ProjectRow {
  id: number;
  name: string;
  status: string;
  client_name: string | null;
  completion: number;
  blocker_count: number;
  last_report_at: string | null;
}

interface ReportRow {
  id: number;
  project_id: number;
  project_name: string;
  kind: string;
  progress: number | null;
  body: string;
  created_at: string;
  author_name: string | null;
  author_username: string | null;
}

interface SummaryResponse {
  period: Period;
  projects: ProjectRow[];
  reports: ReportRow[];
  summary: {
    projectCount: number;
    avgCompletion: number;
    reportCount: number;
    blockerCount: number;
    doneCount: number;
  };
  error?: string;
}

const PERIOD_LABEL: Record<Period, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
};

const KIND_STYLE: Record<string, { label: string; cls: string }> = {
  update: { label: "Update", cls: "bg-sky-100 text-sky-700 border-sky-200" },
  blocker: {
    label: "Blocker",
    cls: "bg-rose-100 text-rose-700 border-rose-200",
  },
  done: {
    label: "Done",
    cls: "bg-emerald-100 text-emerald-700 border-emerald-200",
  },
};

export default function ExecutionReportsSummary() {
  const [period, setPeriod] = useState<Period>("today");
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/execution-reports/summary?period=${p}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as SummaryResponse;
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [period, load]);

  // Group the period's reports by project for the "one report from all of
  // today's projects" view.
  const grouped = useMemo(() => {
    const map = new Map<number, { name: string; reports: ReportRow[] }>();
    for (const r of data?.reports ?? []) {
      const g = map.get(r.project_id);
      if (g) g.reports.push(r);
      else map.set(r.project_id, { name: r.project_name, reports: [r] });
    }
    return [...map.entries()];
  }, [data]);

  const projects = data?.projects ?? [];

  return (
    <div className="rounded-2xl border border-magic-border bg-white/80 p-4 shadow-mt-soft backdrop-blur-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-magic-ink">
            Execution overview
          </h3>
          <p className="text-xs text-magic-ink/50">
            Completion across your projects, and every report posted{" "}
            {period === "today" ? "today" : `in ${PERIOD_LABEL[period].toLowerCase()}`}.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-magic-border bg-magic-soft/40 p-0.5">
          {(["today", "week", "month"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                period === p
                  ? "bg-white text-magic-red shadow-sm"
                  : "text-magic-ink/55 hover:text-magic-ink"
              }`}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Summary chips */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          icon={Gauge}
          label="Avg completion"
          value={`${data?.summary.avgCompletion ?? 0}%`}
          tone="violet"
        />
        <Stat
          icon={Activity}
          label={`Reports · ${PERIOD_LABEL[period].toLowerCase()}`}
          value={data?.summary.reportCount ?? 0}
          tone="sky"
        />
        <Stat
          icon={AlertTriangle}
          label="Blockers"
          value={data?.summary.blockerCount ?? 0}
          tone="rose"
        />
        <Stat
          icon={CheckCircle2}
          label="Marked done"
          value={data?.summary.doneCount ?? 0}
          tone="emerald"
        />
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Project completion */}
        <div>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-magic-ink/40">
            Project completion
          </h4>
          {loading && projects.length === 0 ? (
            <p className="py-6 text-center text-sm text-magic-ink/40">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="py-6 text-center text-sm text-magic-ink/40">
              No projects in your portfolio yet.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}`}
                    className="block rounded-lg px-1 py-0.5 hover:bg-magic-soft/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-magic-ink">
                        {p.name}
                      </span>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-magic-ink/70">
                        {p.completion}%
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <CompletionBar value={p.completion} status={p.status} />
                      {p.blocker_count > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-rose-600">
                          <AlertTriangle className="h-3 w-3" />
                          {p.blocker_count}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Period reports grouped by project */}
        <div>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-magic-ink/40">
            {period === "today"
              ? "Today's execution"
              : `${PERIOD_LABEL[period]}'s reports`}
          </h4>
          {loading && grouped.length === 0 ? (
            <p className="py-6 text-center text-sm text-magic-ink/40">Loading…</p>
          ) : grouped.length === 0 ? (
            <p className="py-6 text-center text-sm text-magic-ink/40">
              No reports {period === "today" ? "yet today" : "in this period"}.
            </p>
          ) : (
            <div className="max-h-[480px] space-y-3 overflow-y-auto pr-1">
              {grouped.map(([projectId, g]) => (
                <div key={projectId}>
                  <Link
                    href={`/projects/${projectId}`}
                    className="text-xs font-bold text-magic-ink hover:text-magic-red"
                  >
                    {g.name}
                  </Link>
                  <ul className="mt-1 space-y-1.5 border-l-2 border-magic-border/60 pl-3">
                    {g.reports.map((r) => (
                      <li key={r.id} className="text-xs">
                        <div className="flex items-center gap-1.5">
                          <KindBadge kind={r.kind} />
                          {r.progress !== null && (
                            <span className="font-semibold tabular-nums text-magic-ink/60">
                              {r.progress}%
                            </span>
                          )}
                          <span className="text-magic-ink/40">
                            {r.author_name || r.author_username || "—"} ·{" "}
                            {timeAgo(r.created_at)}
                          </span>
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-magic-ink/75">
                          {r.body}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CompletionBar({ value, status }: { value: number; status: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const tone =
    status === "on_hold"
      ? "bg-amber-400"
      : pct >= 100
        ? "bg-emerald-500"
        : pct >= 50
          ? "bg-violet-500"
          : "bg-sky-500";
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-magic-soft">
      <div
        className={`h-full rounded-full transition-all ${tone}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const s = KIND_STYLE[kind] ?? {
    label: kind,
    cls: "bg-gray-100 text-gray-600 border-gray-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

const STAT_TONES: Record<string, string> = {
  violet: "bg-violet-100 text-violet-600",
  sky: "bg-sky-100 text-sky-600",
  rose: "bg-rose-100 text-rose-600",
  emerald: "bg-emerald-100 text-emerald-600",
};

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  tone: keyof typeof STAT_TONES;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-magic-border bg-white px-3 py-2">
      <span
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${STAT_TONES[tone]}`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-bold leading-none text-magic-ink">{value}</p>
        <p className="mt-0.5 truncate text-[11px] text-magic-ink/50">{label}</p>
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
