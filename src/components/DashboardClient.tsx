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
  Clock,
  type LucideIcon,
} from "lucide-react";
import MessagesPanel from "@/components/MessagesPanel";

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
  isManager,
}: {
  data: DashboardData;
  greetingName: string;
  isManager: boolean;
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

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Quotations" value={kpis.quotations} icon={FileText} tone="red" />
        <Kpi label="Clients" value={kpis.clients} icon={Users} tone="indigo" />
        <Kpi label="Companies" value={kpis.companies} icon={Building2} tone="cyan" />
        <Kpi label="Projects" value={kpis.projects} icon={FolderKanban} tone="violet" />
        <Kpi
          label="Awaiting approval"
          value={kpis.pendingApprovals}
          icon={Clock}
          tone="amber"
        />
      </div>

      {/* Charts + inbox */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl border border-magic-border bg-white/80 p-4 shadow-mt-soft backdrop-blur-sm">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-magic-ink">
                  Quotations created
                </h3>
                <p className="text-xs text-magic-ink/50">
                  {GRANULARITY_META[granularity].subtitle}
                </p>
              </div>
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
                    name="Quotations"
                    stroke="#E2231A"
                    strokeWidth={2.5}
                    fill="url(#qGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <Panel title="Sales outcomes" subtitle="Won · Lost · Held for execution">
            <div className="grid grid-cols-3 gap-3">
              <OutcomeStat label="Won" value={outcomes.won} tone="emerald" />
              <OutcomeStat label="Lost" value={outcomes.lost} tone="amber" />
              <OutcomeStat label="Held" value={outcomes.held} tone="red" />
            </div>
          </Panel>

          <div className="grid gap-4 sm:grid-cols-2">
            <Panel title="By status" subtitle="Active quotations">
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
            </Panel>

            <Panel
              title="Approval funnel"
              subtitle={isManager ? "Across your team" : "Your quotations"}
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
            </Panel>
          </div>
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

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-magic-border bg-white/80 p-4 shadow-mt-soft backdrop-blur-sm">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-magic-ink">{title}</h3>
        {subtitle && <p className="text-xs text-magic-ink/50">{subtitle}</p>}
      </div>
      {children}
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
