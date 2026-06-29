"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Users,
  ShieldCheck,
  KeyRound,
  Building2,
  type LucideIcon,
} from "lucide-react";
import MessagesPanel from "@/components/MessagesPanel";
import HandoverPresalesButton from "@/components/HandoverPresalesButton";

export interface DepartmentRow {
  /** Department code (e.g. "ITD1"); "Unassigned" groups users with no code. */
  code: string;
  users: number;
  quotations: number;
}

export interface AdminDashboardData {
  kpis: {
    users: number;
    admins: number;
    withRole: number;
    departments: number;
  };
  departments: DepartmentRow[];
}

export default function AdminDashboardClient({
  data,
  greetingName,
}: {
  data: AdminDashboardData;
  greetingName: string;
}) {
  const { kpis, departments } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-magic-ink">
          Welcome back, {greetingName}.
        </h1>
        <p className="mt-0.5 text-sm text-magic-ink/60">
          Administration overview — people, roles and departments at a glance.
        </p>
      </div>

      {/* One-click handover of all presales work */}
      <HandoverPresalesButton />

      {/* Admin KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Users" value={kpis.users} icon={Users} tone="indigo" />
        <Kpi label="Admins" value={kpis.admins} icon={ShieldCheck} tone="red" />
        <Kpi label="With a role" value={kpis.withRole} icon={KeyRound} tone="cyan" />
        <Kpi
          label="Departments"
          value={kpis.departments}
          icon={Building2}
          tone="violet"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel
            title="Per-department breakdown"
            subtitle="People and quotations grouped by department code"
          >
            {departments.length === 0 ? (
              <EmptyChart />
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={departments}
                    margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#E4E7F1"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="code"
                      tick={{ fontSize: 11, fill: "#6b7280" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#6b7280" }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid #E4E7F1",
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar
                      dataKey="users"
                      name="Users"
                      fill="#5b7884"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="quotations"
                      name="Quotations"
                      fill="#b08968"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <Panel title="Departments" subtitle="Detailed counts">
            {departments.length === 0 ? (
              <p className="py-6 text-center text-xs text-magic-ink/40">
                No users yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-magic-border text-left text-xs text-magic-ink/50">
                      <th className="px-3 py-2 font-semibold">Department</th>
                      <th className="px-3 py-2 text-right font-semibold">Users</th>
                      <th className="px-3 py-2 text-right font-semibold">
                        Quotations
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {departments.map((d) => (
                      <tr
                        key={d.code}
                        className="border-b border-magic-border/60 last:border-0"
                      >
                        <td className="px-3 py-2 font-mono font-semibold text-magic-ink">
                          {d.code}
                        </td>
                        <td className="px-3 py-2 text-right text-magic-ink/80">
                          {d.users}
                        </td>
                        <td className="px-3 py-2 text-right text-magic-ink/80">
                          {d.quotations}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
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

const TONES: Record<string, { ring: string; icon: string }> = {
  red: { ring: "from-magic-red/15 to-white", icon: "bg-magic-red/10 text-magic-red" },
  indigo: { ring: "from-indigo-100 to-white", icon: "bg-indigo-100 text-indigo-600" },
  cyan: { ring: "from-cyan-100 to-white", icon: "bg-cyan-100 text-cyan-600" },
  violet: { ring: "from-violet-100 to-white", icon: "bg-violet-100 text-violet-600" },
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
        <span
          className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${t.icon}`}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight text-magic-ink">
        {value}
      </p>
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
    <div className="flex h-72 items-center justify-center text-center">
      <p className="text-xs text-magic-ink/40">No data yet.</p>
    </div>
  );
}
