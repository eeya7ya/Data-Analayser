"use client";

import { useState } from "react";
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
  ArrowUpRight,
  ChevronDown,
  Trophy,
  Layers,
  ClipboardCheck,
  type LucideIcon,
} from "lucide-react";
import MessagesPanel from "@/components/MessagesPanel";
import QuickLeadCreate from "@/components/QuickLeadCreate";

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
  const approvalData = [
    { name: "Approved", value: approvals.approved },
    { name: "Pending", value: approvals.pending },
    { name: "Rejected", value: approvals.rejected },
  ].filter((d) => d.value > 0);
  // Headline numbers shown on each collapsed chart card so the board still
  // conveys the figures at a glance without a wall of always-open charts.
  const trendTotal = trend.reduce((s, p) => s + p.count, 0);
  const statusTotal = status.reduce((s, r) => s + r.value, 0);

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

      {/* Fast navigation + one-screen lead intake for sales, so a salesperson
          jumps straight into their day without hunting through the menu. */}
      {canCreateLead && (
        <div className="space-y-4">
          <section>
            <div className="mb-2.5 flex items-center gap-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-magic-ink/45">
                Quick access
              </span>
              <span className="h-px flex-1 bg-magic-border/70" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <QuickNav
                href="/crm/pipeline"
                label="Pipeline"
                hint="Live deals & forecast"
                icon={TrendingUp}
                tone="red"
              />
              <QuickNav
                href="/crm/received"
                label="Received"
                hint="Quotations sent to you"
                icon={Inbox}
                tone="cyan"
              />
              <QuickNav
                href="/leads"
                label="Leads"
                hint="Requests & status"
                icon={ClipboardList}
                tone="indigo"
              />
              <QuickNav
                href="/crm?tool=sales"
                label="Clients"
                hint="Companies & folders"
                icon={Building2}
                tone="violet"
              />
              <QuickNav
                href="/calendar"
                label="Calendar"
                hint="Follow-ups"
                icon={CalendarDays}
                tone="amber"
              />
              <QuickNav
                href="/email"
                label="Email"
                hint="Client mail"
                icon={Mail}
                tone="sky"
              />
            </div>
          </section>
          <QuickLeadCreate />
        </div>
      )}

      {/* KPI strip. The old "Awaiting approval" card was retired in V1.8: the
          sign-off step was removed back in v1.70, so that counter just tallied
          every un-approved quotation (i.e. the whole live Quoting pipeline)
          under a misleading label — legacy dead data with no action behind it.
          The pipeline board is the source of truth for open deals now. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={primaryKpiLabel} value={kpis.quotations} icon={FileText} tone="red" />
        <Kpi label="Clients" value={kpis.clients} icon={Users} tone="indigo" />
        <Kpi label="Companies" value={kpis.companies} icon={Building2} tone="cyan" />
        <Kpi label="Projects" value={kpis.projects} icon={FolderKanban} tone="violet" />
      </div>

      {/* Analytics + inbox. Charts are click-to-open: each card shows its
          headline numbers when collapsed and reveals the chart on click, so the
          board stays clean instead of a wall of (often empty) charts. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          <CollapsibleChart
            title={chartTitle}
            icon={TrendingUp}
            tone="red"
            openSubtitle={GRANULARITY_META[granularity].subtitle}
            summary={`${trendTotal} in the last 6 months · tap to open`}
          >
            <div className="mb-3 flex justify-end">
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
            </div>
            <div className="h-64 w-full">
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
          </CollapsibleChart>

          {showOutcomes && (
            <CollapsibleChart
              title="Sales outcomes"
              icon={Trophy}
              tone="emerald"
              openSubtitle="Won · Lost · Held for execution"
              summary={`${outcomes.won} won · ${outcomes.lost} lost · ${outcomes.held} held`}
            >
              <div className="grid grid-cols-3 gap-3">
                <OutcomeStat label="Won" value={outcomes.won} tone="emerald" />
                <OutcomeStat label="Lost" value={outcomes.lost} tone="amber" />
                <OutcomeStat label="Held" value={outcomes.held} tone="red" />
              </div>
            </CollapsibleChart>
          )}

          <CollapsibleChart
            title="By status"
            icon={Layers}
            tone="cyan"
            openSubtitle="Active quotations"
            summary={
              statusTotal === 0 ? "No data yet" : `${statusTotal} active quotations`
            }
          >
            {status.length === 0 ? (
              <EmptyChart />
            ) : (
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={status}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={45}
                      outerRadius={75}
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
          </CollapsibleChart>

          <CollapsibleChart
            title="Approval funnel"
            icon={ClipboardCheck}
            tone="violet"
            openSubtitle={showApprovals ? "Across your team" : "Your quotations"}
            summary={`${approvals.approved} approved · ${approvals.pending} pending · ${approvals.rejected} rejected`}
          >
            {approvalData.length === 0 ? (
              <EmptyChart />
            ) : (
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={approvalData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={45}
                      outerRadius={75}
                      paddingAngle={3}
                    >
                      <Cell fill="#22c55e" />
                      <Cell fill="#f59e0b" />
                      <Cell fill="#ef4444" />
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E4E7F1", fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CollapsibleChart>
        </div>

        {/* Inbox — alarms + messages */}
        <div className="lg:col-span-1">
          <div className="h-[560px]">
            <MessagesPanel />
          </div>
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
 * A chart card that stays collapsed by default — the header carries the
 * headline numbers so the board reads at a glance, and clicking it reveals
 * the full chart. Keeps the dashboard from being a wall of always-open
 * (often empty) charts.
 */
function CollapsibleChart({
  title,
  icon: Icon,
  tone,
  openSubtitle,
  summary,
  children,
}: {
  title: string;
  icon: LucideIcon;
  tone: keyof typeof NAV_TONES;
  /** Shown under the title when expanded (chart context). */
  openSubtitle: string;
  /** Shown under the title when collapsed (headline figures). */
  summary: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const t = NAV_TONES[tone];
  return (
    <div className="overflow-hidden rounded-2xl border border-magic-border bg-white/80 shadow-mt-soft backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-magic-soft/40"
      >
        <span
          className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${t.chip}`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-magic-ink">{title}</span>
          <span className="block truncate text-xs text-magic-ink/50">
            {open ? openSubtitle : summary}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-magic-ink/40 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="border-t border-magic-border/60 p-4">{children}</div>
      )}
    </div>
  );
}

function QuickNav({
  href,
  label,
  hint,
  icon: Icon,
  tone,
}: {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  tone: keyof typeof NAV_TONES;
}) {
  const t = NAV_TONES[tone];
  return (
    <a
      href={href}
      className="group relative flex flex-col justify-between gap-4 overflow-hidden rounded-2xl border border-magic-border bg-white p-3.5 shadow-mt-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-magic-red/30 hover:shadow-mt-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magic-red/40"
    >
      {/* Soft tone wash that fades in on hover for a bit of depth. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${t.wash} opacity-0 transition-opacity duration-200 group-hover:opacity-100`}
      />
      <span className="relative flex items-center justify-between">
        <span
          className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${t.chip}`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <ArrowUpRight
          className={`h-4 w-4 text-magic-ink/25 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 ${t.arrow}`}
        />
      </span>
      <span className="relative min-w-0">
        <span className="block text-sm font-bold text-magic-ink">{label}</span>
        <span className="block truncate text-xs text-magic-ink/50">{hint}</span>
      </span>
    </a>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
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
      <p className="mt-3 text-3xl font-bold tracking-tight text-magic-ink">{value}</p>
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

function EmptyChart() {
  return (
    <div className="flex h-52 items-center justify-center text-center">
      <p className="text-xs text-magic-ink/40">No data yet.</p>
    </div>
  );
}
