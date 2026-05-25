"use client";

import Link from "next/link";
import {
  FolderKanban,
  Hammer,
  CheckCircle2,
  MessageSquareText,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import MessagesPanel from "@/components/MessagesPanel";

/**
 * Execution dashboard for projects-module people (technician / engineer /
 * project manager). They don't care about quotation analytics — this
 * board surfaces the projects pushed to them, their execution status,
 * and (for managers) the handoff queue waiting to be assigned.
 */

export interface ExecutionProject {
  id: number;
  name: string;
  status: string;
  role: string;
  notes: string | null;
  client_name: string | null;
  updated_at: string;
}

interface ExecutionKpis {
  myProjects: number;
  inExecution: number;
  completed: number;
  myReports: number;
  awaitingAssignment: number;
}

const STATUS_STYLE: Record<string, string> = {
  open: "bg-cyan-100 text-cyan-700 border-cyan-200",
  in_progress: "bg-violet-100 text-violet-700 border-violet-200",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  on_hold: "bg-amber-100 text-amber-800 border-amber-200",
};

const ROLE_LABEL: Record<string, string> = {
  technical: "Technician",
  engineer: "Engineer",
  manager: "Project Manager",
};

export default function ExecutionDashboardClient({
  greetingName,
  isManager,
  kpis,
  projects,
}: {
  greetingName: string;
  isManager: boolean;
  kpis: ExecutionKpis;
  projects: ExecutionProject[];
}) {
  const sorted = [...projects].sort(
    (a, b) => +new Date(b.updated_at) - +new Date(a.updated_at),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-magic-ink">
          Welcome back, {greetingName}.
        </h1>
        <p className="mt-0.5 text-sm text-magic-ink/60">
          Your execution workload at a glance — projects assigned to you and
          their progress.
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="My projects" value={kpis.myProjects} icon={FolderKanban} tone="violet" />
        <Kpi label="In execution" value={kpis.inExecution} icon={Hammer} tone="cyan" />
        <Kpi label="Completed" value={kpis.completed} icon={CheckCircle2} tone="emerald" />
        <Kpi label="Reports posted" value={kpis.myReports} icon={MessageSquareText} tone="indigo" />
        {isManager && (
          <Kpi
            label="Awaiting assignment"
            value={kpis.awaitingAssignment}
            icon={Inbox}
            tone="amber"
            href="/projects/handoffs"
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Assigned projects */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-magic-border bg-white/80 p-4 shadow-mt-soft backdrop-blur-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-magic-ink">My projects</h3>
                <p className="text-xs text-magic-ink/50">
                  Pushed to you for execution — open one to log progress,
                  notes and follow-ups.
                </p>
              </div>
              <Link
                href="/projects"
                className="text-xs font-semibold text-magic-red hover:underline"
              >
                View all →
              </Link>
            </div>

            {sorted.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-center">
                <p className="text-sm text-magic-ink/40">
                  Nothing assigned to you yet.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-magic-border/50">
                {sorted.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/projects/${p.id}`}
                      className="flex items-start justify-between gap-3 py-2.5 transition-colors hover:bg-magic-soft/40"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-magic-ink">
                          {p.name}
                        </div>
                        <div className="truncate text-xs text-magic-ink/55">
                          {p.client_name || "—"}
                          {" · "}
                          {ROLE_LABEL[p.role] ?? p.role}
                        </div>
                        {p.notes && (
                          <div className="mt-0.5 truncate text-xs text-magic-ink/45">
                            {p.notes}
                          </div>
                        )}
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                          STATUS_STYLE[p.status] ??
                          "bg-gray-100 text-gray-600 border-gray-200"
                        }`}
                      >
                        {p.status.replace(/_/g, " ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
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

const TONES: Record<string, { ring: string; icon: string }> = {
  violet: { ring: "from-violet-100 to-white", icon: "bg-violet-100 text-violet-600" },
  cyan: { ring: "from-cyan-100 to-white", icon: "bg-cyan-100 text-cyan-600" },
  emerald: { ring: "from-emerald-100 to-white", icon: "bg-emerald-100 text-emerald-600" },
  indigo: { ring: "from-indigo-100 to-white", icon: "bg-indigo-100 text-indigo-600" },
  amber: { ring: "from-amber-100 to-white", icon: "bg-amber-100 text-amber-600" },
};

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
  href,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: keyof typeof TONES;
  href?: string;
}) {
  const t = TONES[tone];
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${t.icon}`}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight text-magic-ink">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-magic-ink/55">{label}</p>
    </>
  );
  const cls = `block rounded-2xl border border-magic-border bg-gradient-to-br ${t.ring} p-4 shadow-mt-soft transition-shadow hover:shadow-mt-lift`;
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
