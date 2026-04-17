"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

interface Summary {
  counts: { contacts: number; companies: number; deals: number; tasks_open: number };
  pipeline_value: number;
  won_value: number;
  stages: {
    stage_id: number;
    name: string;
    position: number;
    is_won: boolean;
    is_lost: boolean;
    count: number;
    total: number;
  }[];
  daily_deals: { day: string; count: number }[];
  activity: { verb: string; count: number }[];
}

const COLORS = ["#dc2626", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];

export default function Dashboard() {
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/crm/analytics/summary")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setS(d);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!s) return <p className="text-sm text-magic-ink/60">Loading dashboard…</p>;

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-magic-ink">Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Contacts" value={s.counts.contacts} />
        <Stat label="Companies" value={s.counts.companies} />
        <Stat label="Open deals" value={s.counts.deals} />
        <Stat label="Open tasks" value={s.counts.tasks_open} />
        <Stat label="Pipeline value" value={`$${fmt(s.pipeline_value)}`} wide />
        <Stat label="Won value" value={`$${fmt(s.won_value)}`} wide accent />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Deals by stage (count)">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={s.stages}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Deals by stage (value)">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={s.stages}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => `$${fmt(Number(v))}`} />
              <Bar dataKey="total" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Deals created (last 30 days)">
          {s.daily_deals.length === 0 ? (
            <p className="text-xs text-magic-ink/60 text-center py-12">No deals yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={s.daily_deals}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#dc2626" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Activity (last 30 days)">
          {s.activity.length === 0 ? (
            <p className="text-xs text-magic-ink/60 text-center py-12">No activity yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={s.activity}
                  dataKey="count"
                  nameKey="verb"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label
                >
                  {s.activity.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  wide,
  accent,
}: {
  label: string;
  value: number | string;
  wide?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={
        "rounded-2xl border border-magic-border bg-white p-4 " +
        (wide ? "col-span-2 " : "") +
        (accent ? "bg-gradient-to-br from-magic-red/10 to-amber-50" : "")
      }
    >
      <div className="text-[11px] font-semibold uppercase text-magic-ink/60">{label}</div>
      <div className="mt-1 text-2xl font-bold text-magic-ink">{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-magic-border bg-white p-4">
      <h2 className="text-sm font-semibold text-magic-ink mb-3">{title}</h2>
      {children}
    </div>
  );
}
