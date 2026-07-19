"use client";

import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  FileText,
  Users,
  Building2,
  FolderKanban,
  TrendingUp,
  Inbox,
  CalendarDays,
  ClipboardList,
  Mail,
  Trophy,
  Layers,
  ClipboardCheck,
  LayoutGrid,
  X,
  type LucideIcon,
} from "@/lib/icons";
import MessagesPanel from "@/components/MessagesPanel";
import QuickLeadCreate from "@/components/QuickLeadCreate";
import HelpTip from "@/components/HelpTip";

interface TrendPoint {
  label: string;
  count: number;
}

export interface DashboardData {
  kpis: {
    quotations: number;
    clients: number;
    companies: number;
    projects: number;
    pendingApprovals: number;
  };
  monthly: TrendPoint[];
  weekly: TrendPoint[];
  daily: TrendPoint[];
  outcomes: { won: number; lost: number; held: number };
  status: { name: string; value: number }[];
  approvals: { approved: number; pending: number; rejected: number };
}

type Granularity = "daily" | "weekly" | "monthly";

const GRANULARITY_META: Record<
  Granularity,
  { label: string; subtitle: string }
> = {
  daily: { label: "Daily", subtitle: "Last 30 days" },
  weekly: { label: "Weekly", subtitle: "Last 12 weeks" },
  monthly: { label: "Monthly", subtitle: "Last 6 months" },
};

const STATUS_COLORS = ["#06B6D4", "#6366F1", "#f59e0b", "#22c55e", "#ef4444", "#8b5cf6"];

export default function DashboardClient({
  data,
  greetingName,
  showApprovals,
  showOutcomes,
  canCreateLead = false,
  primaryKpiLabel = "Quotations",
  chartTitle = "Quotations created",
  chartNoun = "Quotations",
}: {
  data: DashboardData;
  greetingName: string;
  /** Sales / presales / admin: show the one-screen quick-create lead widget. */
  canCreateLead?: boolean;
  /**
   * Approvals are sales-only (1.4A). True only for sales managers / admin —
   * gates the "Awaiting approval" action card so presales never see it.
   */
  showApprovals: boolean;
  /** "Sales outcomes" (Won/Lost/Held) is a sales-only scoreboard. */
  showOutcomes: boolean;
  /** Label for the lead KPI card (e.g. "Deals won" in the sales lens). */
  primaryKpiLabel?: string;
  /** Headline trend-chart title + the metric noun used in the area/tooltip. */
  chartTitle?: string;
  chartNoun?: string;
}) {
  const { kpis, status, approvals, outcomes } = data;
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const trend =
    granularity === "daily"
      ? data.daily
      : granularity === "weekly"
        ? data.weekly
        : data.monthly;
  const trendTotal = trend.reduce((s, p) => s + p.count, 0);
  // Win rate = won / decided (won + lost); null until there's a decided deal.
  const decided = outcomes.won + outcomes.lost;
  const winRate = decided > 0 ? Math.round((outcomes.won / decided) * 100) : null;
  const outcomeTotal = outcomes.won + outcomes.lost + outcomes.held;
  const outcomeData = [
    { name: "Won", value: outcomes.won, color: "#22c55e" },
    { name: "Lost", value: outcomes.lost, color: "#f59e0b" },
    { name: "Held", value: outcomes.held, color: "#E2231A" },
  ].filter((d) => d.value > 0);
  const approvalTotal =
    approvals.approved + approvals.pending + approvals.rejected;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-magic-ink">
          Welcome back, {greetingName}.
        </h1>
        <p className="mt-0.5 text-sm text-magic-ink/60">
          Your activity at a glance. Open the menu (top-left) to jump into any module.
        </p>
      </div>

      {/* One-screen lead intake for sales. Fast navigation lives in the
          floating radial dial (QuickAccessDial) pinned to the bottom of the
          page, so it never competes with the dashboard content. */}
      {canCreateLead && (
        <>
          <QuickLeadCreate />
          <QuickAccessDial />
        </>
      )}

      {/* KPI strip. The old "Awaiting approval" card was retired in V1.8: the
          sign-off step was removed back in v1.70, so that counter just tallied
          every un-approved quotation (i.e. the whole live Quoting pipeline)
          under a misleading label — legacy dead data with no action behind it.
          The pipeline board is the source of truth for open deals now. */}
      <div className="mb-2 flex items-center gap-1.5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-magic-ink/55">
          At a glance
        </h2>
        <HelpTip id="dashboard.kpis" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Kpi label={primaryKpiLabel} value={kpis.quotations} icon={FileText} tone="red" />
        <Kpi
          label="Win rate"
          value={winRate ?? 0}
          display={winRate === null ? "—" : `${winRate}%`}
          icon={Trophy}
          tone="emerald"
        />
        <Kpi label="Clients" value={kpis.clients} icon={Users} tone="indigo" />
        <Kpi label="Companies" value={kpis.companies} icon={Building2} tone="cyan" />
        <Kpi label="Projects" value={kpis.projects} icon={FolderKanban} tone="violet" />
      </div>

      {/* Primary analytics — a big always-on trend chart beside the win/loss
          donut, the way a real sales board reads. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title={chartTitle}
          subtitle={`${GRANULARITY_META[granularity].subtitle} · ${trendTotal} total`}
          icon={TrendingUp}
          tone="red"
          helpId="dashboard.trend"
          right={
            <div className="inline-flex items-center gap-0.5 rounded-lg border border-magic-border bg-magic-soft/40 p-0.5">
              {(["daily", "weekly", "monthly"] as Granularity[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                    granularity === g
                      ? "bg-magic-red text-white shadow-sm"
                      : "text-magic-ink/60 hover:text-magic-ink"
                  }`}
                >
                  {GRANULARITY_META[g].label}
                </button>
              ))}
            </div>
          }
        >
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="qGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#E2231A" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#E2231A" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E7F1" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #E4E7F1",
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  name={chartNoun}
                  stroke="#E2231A"
                  strokeWidth={2.5}
                  fill="url(#qGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="Sales outcomes"
          subtitle="Won · Lost · Held"
          icon={Trophy}
          tone="emerald"
          helpId="dashboard.outcomes"
        >
          {outcomeTotal === 0 ? (
            <EmptyChart label="No decided deals yet." />
          ) : (
            <div className="relative h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={outcomeData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={54}
                    outerRadius={72}
                    paddingAngle={3}
                    startAngle={90}
                    endAngle={-270}
                  >
                    {outcomeData.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E4E7F1", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold tracking-tight text-magic-ink">
                  {winRate === null ? "—" : `${winRate}%`}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-magic-ink/45">
                  Win rate
                </span>
              </div>
            </div>
          )}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <OutcomeStat label="Won" value={outcomes.won} tone="emerald" />
            <OutcomeStat label="Lost" value={outcomes.lost} tone="amber" />
            <OutcomeStat label="Held" value={outcomes.held} tone="red" />
          </div>
        </ChartCard>
      </div>

      {/* Secondary analytics + inbox, all on one row. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="By status" subtitle="Active quotations" icon={Layers} tone="cyan" helpId="dashboard.status">
          {status.length === 0 ? (
            <EmptyChart label="No active quotations yet." />
          ) : (
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={status}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={72}
                    paddingAngle={3}
                  >
                    {status.map((_, i) => (
                      <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E4E7F1", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Approval funnel"
          subtitle={showApprovals ? "Across your team" : "Your quotations"}
          icon={ClipboardCheck}
          tone="violet"
        >
          {approvalTotal === 0 ? (
            <EmptyChart label="Nothing to approve yet." />
          ) : (
            <div className="flex h-52 flex-col justify-center gap-3">
              <FunnelBar label="Approved" value={approvals.approved} total={approvalTotal} color="#22c55e" />
              <FunnelBar label="Pending" value={approvals.pending} total={approvalTotal} color="#f59e0b" />
              <FunnelBar label="Rejected" value={approvals.rejected} total={approvalTotal} color="#ef4444" />
            </div>
          )}
        </ChartCard>

        {/* Inbox — alarms + messages. MessagesPanel fills its container, so it
            needs an explicit height; sized to sit level with the two cards
            beside it. */}
        <div className="h-[300px]">
          <MessagesPanel />
        </div>
      </div>
    </div>
  );
}

const TONES: Record<string, { ring: string; icon: string; text: string }> = {
  red: { ring: "from-magic-red/15 to-white", icon: "bg-magic-red/10 text-magic-red", text: "text-magic-red" },
  indigo: { ring: "from-indigo-100 to-white", icon: "bg-indigo-100 text-indigo-600", text: "text-indigo-600" },
  cyan: { ring: "from-cyan-100 to-white", icon: "bg-cyan-100 text-cyan-600", text: "text-cyan-600" },
  violet: { ring: "from-violet-100 to-white", icon: "bg-violet-100 text-violet-600", text: "text-violet-600" },
  amber: { ring: "from-amber-100 to-white", icon: "bg-amber-100 text-amber-600", text: "text-amber-600" },
  emerald: { ring: "from-emerald-100 to-white", icon: "bg-emerald-100 text-emerald-600", text: "text-emerald-600" },
};

const NAV_TONES: Record<
  string,
  { chip: string; wash: string; arrow: string }
> = {
  red: {
    chip: "bg-magic-red/10 text-magic-red",
    wash: "from-magic-red/[0.07] to-transparent",
    arrow: "group-hover:text-magic-red",
  },
  cyan: {
    chip: "bg-cyan-100 text-cyan-600",
    wash: "from-cyan-50 to-transparent",
    arrow: "group-hover:text-cyan-600",
  },
  indigo: {
    chip: "bg-indigo-100 text-indigo-600",
    wash: "from-indigo-50 to-transparent",
    arrow: "group-hover:text-indigo-600",
  },
  violet: {
    chip: "bg-violet-100 text-violet-600",
    wash: "from-violet-50 to-transparent",
    arrow: "group-hover:text-violet-600",
  },
  amber: {
    chip: "bg-amber-100 text-amber-600",
    wash: "from-amber-50 to-transparent",
    arrow: "group-hover:text-amber-600",
  },
  sky: {
    chip: "bg-sky-100 text-sky-600",
    wash: "from-sky-50 to-transparent",
    arrow: "group-hover:text-sky-600",
  },
  emerald: {
    chip: "bg-emerald-100 text-emerald-600",
    wash: "from-emerald-50 to-transparent",
    arrow: "group-hover:text-emerald-600",
  },
};

/**
 * An always-visible chart card: a titled header (icon chip + title + subtitle,
 * optional right-hand control) over the chart body. The shared frame is what
 * makes the analytics read as one board.
 */
function ChartCard({
  title,
  subtitle,
  icon: Icon,
  tone,
  right,
  className = "",
  helpId,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  tone: keyof typeof NAV_TONES;
  right?: React.ReactNode;
  className?: string;
  /** Optional HELP_TIPS id — renders a ⍰ marker next to the title. */
  helpId?: string;
  children: React.ReactNode;
}) {
  const t = NAV_TONES[tone];
  return (
    <div
      className={`rounded-2xl border border-magic-border bg-white/80 p-4 shadow-mt-soft backdrop-blur-sm ${className}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${t.chip}`}
          >
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-magic-ink">
              <span className="truncate">{title}</span>
              {helpId && <HelpTip id={helpId} />}
            </h3>
            {subtitle && (
              <p className="truncate text-xs text-magic-ink/50">{subtitle}</p>
            )}
          </div>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** A single horizontal bar in the approval funnel: label, proportional bar, count. */
function FunnelBar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold text-magic-ink/70">{label}</span>
        <span className="tabular-nums text-magic-ink/50">
          {value} · {pct}%
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-magic-soft">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.max(pct, value > 0 ? 4 : 0)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

const DIAL_ITEMS: Array<{
  href: string;
  label: string;
  icon: LucideIcon;
  tone: keyof typeof NAV_TONES;
}> = [
  { href: "/crm/pipeline", label: "Pipeline", icon: TrendingUp, tone: "red" },
  { href: "/crm/received", label: "Received", icon: Inbox, tone: "cyan" },
  { href: "/leads", label: "Leads", icon: ClipboardList, tone: "indigo" },
  { href: "/crm?tool=sales", label: "Clients", icon: Building2, tone: "violet" },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, tone: "amber" },
  { href: "/email", label: "Email", icon: Mail, tone: "sky" },
];

/**
 * Floating quick-access dial — a single circular button pinned to the bottom
 * of the page that fans its child circles out in a semicircle on click
 * (a radial speed-dial), instead of a row of tiles competing with the
 * dashboard content.
 */
function QuickAccessDial() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const R = 118; // fan radius
  const n = DIAL_ITEMS.length;
  return (
    <div className="no-print">
      {/* Dim backdrop so the fanned menu reads as a focused overlay. */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden
        className={`fixed inset-0 z-40 bg-magic-ink/20 backdrop-blur-[1px] transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <div className="fixed bottom-7 left-1/2 z-50 -translate-x-1/2">
        {DIAL_ITEMS.map((it, i) => {
          // Fan across a 150° arc (165°→15°, left to right) above the button.
          const angle = 165 - (i * 150) / (n - 1);
          const rad = (angle * Math.PI) / 180;
          const dx = Math.cos(rad) * R;
          const dy = -Math.sin(rad) * R;
          const t = NAV_TONES[it.tone];
          const Icon = it.icon;
          return (
            <a
              key={it.href}
              href={it.href}
              title={it.label}
              className="absolute bottom-0 left-1/2"
              style={{
                transform: open
                  ? `translate(calc(-50% + ${dx}px), ${dy}px) scale(1)`
                  : "translate(-50%, 0) scale(0.4)",
                opacity: open ? 1 : 0,
                transition:
                  "transform .34s cubic-bezier(.34,1.56,.64,1), opacity .2s",
                transitionDelay: open ? `${i * 30}ms` : `${(n - i) * 16}ms`,
                pointerEvents: open ? "auto" : "none",
              }}
            >
              <span
                className={`relative flex h-12 w-12 items-center justify-center rounded-full ring-2 ring-white shadow-mt-lift transition-transform hover:scale-110 ${t.chip}`}
              >
                <Icon className="h-5 w-5" />
                <span className="absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-magic-ink px-2 py-0.5 text-[10px] font-semibold text-white shadow">
                  {it.label}
                </span>
              </span>
            </a>
          );
        })}
        {/* The dial button itself. */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Quick access"
          aria-expanded={open}
          className="relative flex h-14 w-14 items-center justify-center rounded-full bg-magic-red text-white shadow-mt-lift transition-transform duration-200 hover:scale-105"
        >
          <span
            className={`transition-transform duration-300 ${
              open ? "rotate-90" : ""
            }`}
          >
            {open ? <X className="h-6 w-6" /> : <LayoutGrid className="h-6 w-6" />}
          </span>
        </button>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  display,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  /** Overrides the rendered value (e.g. "72%" or "—" for win rate). */
  display?: string;
  icon: LucideIcon;
  tone: keyof typeof TONES;
}) {
  const t = TONES[tone];
  return (
    <div
      className={`rounded-2xl border border-magic-border bg-gradient-to-br ${t.ring} p-4 shadow-mt-soft transition-shadow hover:shadow-mt-lift`}
    >
      <div className="flex items-center justify-between">
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${t.icon}`}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight text-magic-ink">
        {display ?? value}
      </p>
      <p className="mt-0.5 text-xs font-medium text-magic-ink/55">{label}</p>
    </div>
  );
}

const OUTCOME_TONES: Record<string, string> = {
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-magic-red/5 text-magic-red ring-magic-red/20",
};

function OutcomeStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: keyof typeof OUTCOME_TONES;
}) {
  return (
    <div
      className={`rounded-xl px-3 py-3 text-center ring-1 ${OUTCOME_TONES[tone]}`}
    >
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs font-semibold">{label}</p>
    </div>
  );
}

function EmptyChart({ label = "No data yet." }: { label?: string }) {
  return (
    <div className="flex h-52 items-center justify-center text-center">
      <p className="text-xs text-magic-ink/40">{label}</p>
    </div>
  );
}
