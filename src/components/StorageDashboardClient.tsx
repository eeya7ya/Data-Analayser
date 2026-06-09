"use client";

import Link from "next/link";
import { ClipboardCheck, CheckCircle2, type LucideIcon } from "lucide-react";
import MessagesPanel from "@/components/MessagesPanel";

/**
 * Storage dashboard. V1.5A removed the legacy flat inventory (requests /
 * stock / locations), so the storage team's live surface is the BOQ
 * stock-checks inbox plus messages. The new event-sourced stock module
 * (docs/storage-module-v1.5A.md) will add its own widgets here once built.
 */

export interface StorageCheckRow {
  id: number;
  quotation_id: number;
  quotation_ref: string;
  project_name: string | null;
  item_count: number;
  created_at: string;
}

interface StorageKpis {
  pendingChecks: number;
  answeredChecks: number;
}

export default function StorageDashboardClient({
  greetingName,
  kpis,
  checks,
}: {
  greetingName: string;
  kpis: StorageKpis;
  checks: StorageCheckRow[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-magic-ink">
          Welcome back, {greetingName}.
        </h1>
        <p className="mt-0.5 text-sm text-magic-ink/60">
          Your stock-check inbox at a glance — BoM availability requests from
          quotations.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <Kpi
          label="Pending checks"
          value={kpis.pendingChecks}
          icon={ClipboardCheck}
          tone="amber"
          href="/storage"
        />
        <Kpi
          label="Answered"
          value={kpis.answeredChecks}
          icon={CheckCircle2}
          tone="emerald"
          href="/storage"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-magic-border bg-white/80 p-4 shadow-mt-soft backdrop-blur-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-magic-ink">
                  Pending stock checks
                </h3>
                <p className="text-xs text-magic-ink/50">
                  BoM availability requested by presales — open Storage to
                  answer.
                </p>
              </div>
              <Link
                href="/storage"
                className="text-xs font-semibold text-magic-red hover:underline"
              >
                Open storage →
              </Link>
            </div>

            {checks.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-center">
                <p className="text-sm text-magic-ink/40">
                  No pending checks. Inbox zero.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-magic-border/50">
                {checks.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-magic-ink">
                        {c.quotation_ref}
                      </div>
                      <div className="truncate text-xs text-magic-ink/55">
                        {c.project_name || "Unassigned project"} ·{" "}
                        {new Date(c.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-magic-soft px-2 py-0.5 text-xs font-semibold text-magic-ink/70">
                      {c.item_count} items
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

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
  amber: { ring: "from-amber-100 to-white", icon: "bg-amber-100 text-amber-600" },
  emerald: {
    ring: "from-emerald-100 to-white",
    icon: "bg-emerald-100 text-emerald-600",
  },
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
      <span
        className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${t.icon}`}
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <p className="mt-3 text-3xl font-bold tracking-tight text-magic-ink">
        {value}
      </p>
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
