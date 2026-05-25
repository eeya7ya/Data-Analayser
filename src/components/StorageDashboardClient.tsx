"use client";

import Link from "next/link";
import {
  Inbox,
  PackageCheck,
  Warehouse,
  Boxes,
  ClipboardCheck,
  type LucideIcon,
} from "lucide-react";
import MessagesPanel from "@/components/MessagesPanel";

/**
 * Warehouse dashboard for storage-module people. Surfaces the request
 * queue and inventory at a glance instead of quotation analytics.
 */

export interface StorageRequestRow {
  id: number;
  quantity: number;
  status: string;
  created_at: string;
  product_label: string;
  project_name: string | null;
}

interface StorageKpis {
  pending: number;
  fulfilled: number;
  locations: number;
  stockItems: number;
  pendingChecks: number;
}

export default function StorageDashboardClient({
  greetingName,
  kpis,
  requests,
}: {
  greetingName: string;
  kpis: StorageKpis;
  requests: StorageRequestRow[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-magic-ink">
          Welcome back, {greetingName}.
        </h1>
        <p className="mt-0.5 text-sm text-magic-ink/60">
          Your warehouse at a glance — the request queue and what&apos;s on
          hand.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Pending requests" value={kpis.pending} icon={Inbox} tone="amber" href="/storage" />
        <Kpi label="Fulfilled" value={kpis.fulfilled} icon={PackageCheck} tone="emerald" />
        <Kpi label="Locations" value={kpis.locations} icon={Warehouse} tone="indigo" />
        <Kpi label="Stock items" value={kpis.stockItems} icon={Boxes} tone="cyan" />
        <Kpi label="Stock checks" value={kpis.pendingChecks} icon={ClipboardCheck} tone="violet" href="/storage" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-magic-border bg-white/80 p-4 shadow-mt-soft backdrop-blur-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-magic-ink">
                  Pending requests
                </h3>
                <p className="text-xs text-magic-ink/50">
                  Stock requested by projects — open Storage to fulfil or deny.
                </p>
              </div>
              <Link
                href="/storage"
                className="text-xs font-semibold text-magic-red hover:underline"
              >
                Open storage →
              </Link>
            </div>

            {requests.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-center">
                <p className="text-sm text-magic-ink/40">
                  No pending requests. You&apos;re all caught up.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-magic-border/50">
                {requests.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-magic-ink">
                        {r.product_label}
                      </div>
                      <div className="truncate text-xs text-magic-ink/55">
                        {r.project_name || "Unassigned project"} ·{" "}
                        {new Date(r.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-magic-soft px-2 py-0.5 text-xs font-semibold text-magic-ink/70">
                      ×{r.quantity}
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
  emerald: { ring: "from-emerald-100 to-white", icon: "bg-emerald-100 text-emerald-600" },
  indigo: { ring: "from-indigo-100 to-white", icon: "bg-indigo-100 text-indigo-600" },
  cyan: { ring: "from-cyan-100 to-white", icon: "bg-cyan-100 text-cyan-600" },
  violet: { ring: "from-violet-100 to-white", icon: "bg-violet-100 text-violet-600" },
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
      <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${t.icon}`}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
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
