"use client";

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

export interface DashboardData {
  kpis: {
    quotations: number;
    clients: number;
    companies: number;
    projects: number;
    pendingApprovals: number;
  };
  monthly: { label: string; count: number }[];
  status: { name: string; value: number }[];
  approvals: { approved: number; pending: number; rejected: number };
}

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
  const { kpis, monthly, status, approvals } = data;
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
          <Panel title="Quotations created" subtitle="Last 6 months">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthly} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
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

function EmptyChart() {
  return (
    <div className="flex h-52 items-center justify-center text-center">
      <p className="text-xs text-magic-ink/40">No data yet.</p>
    </div>
  );
}
