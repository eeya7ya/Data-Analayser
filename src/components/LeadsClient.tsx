"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LEAD_STATUS_LABEL } from "@/lib/leadConstants";

interface Lead {
  id: number;
  ref: string;
  title: string;
  priority: string;
  status: string;
  created_by_username: string | null;
  assigned_to_username: string | null;
  created_at: string;
}

type Tab = "new" | "distributed" | "all";

const PRIORITY_PILL: Record<string, string> = {
  urgent: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  normal: "bg-slate-100 text-slate-800 border-slate-200",
  low: "bg-slate-50 text-slate-500 border-slate-200",
};

const STATUS_PILL: Record<string, string> = {
  new: "bg-sky-100 text-sky-800 border-sky-200",
  distributed: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export default function LeadsClient({ canCreate }: { canCreate: boolean }) {
  const [tab, setTab] = useState<Tab>("new");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (tab !== "all") params.set("status", tab);

    fetch(`/api/leads?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { leads?: Lead[]; error?: string }) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          setLeads([]);
        } else {
          setLeads(data.leads ?? []);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tab]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-xl border border-magic-border bg-white p-1 text-sm shadow-sm">
          <TabButton active={tab === "new"} onClick={() => setTab("new")}>
            New
          </TabButton>
          <TabButton active={tab === "distributed"} onClick={() => setTab("distributed")}>
            Distributed
          </TabButton>
          <TabButton active={tab === "all"} onClick={() => setTab("all")}>
            All
          </TabButton>
        </div>
        {canCreate && (
          <Link
            href="/leads/new"
            className="rounded-lg bg-magic-red px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-magic-red/90"
          >
            + New lead
          </Link>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-magic-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-magic-soft/60 text-left text-[11px] uppercase tracking-wide text-magic-ink/60">
            <tr>
              <th className="px-3 py-2 font-semibold">Ref</th>
              <th className="px-3 py-2 font-semibold">Title</th>
              <th className="px-3 py-2 font-semibold">Priority</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Opened by</th>
              <th className="px-3 py-2 font-semibold">Distributed to</th>
              <th className="px-3 py-2 font-semibold">Opened</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-magic-border/40">
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-magic-ink/50">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && leads.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-magic-ink/50">
                  {tab === "new"
                    ? "No new leads waiting to be distributed."
                    : tab === "distributed"
                      ? "No distributed leads yet."
                      : "No leads yet."}
                </td>
              </tr>
            )}
            {!loading &&
              leads.map((l) => (
                <tr key={l.id} className="transition-colors hover:bg-magic-soft/40">
                  <td className="px-3 py-2 font-mono text-xs text-magic-ink/70">
                    <Link href={`/leads/${l.id}`} className="hover:text-magic-red">
                      {l.ref}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/leads/${l.id}`}
                      className="font-medium text-magic-ink hover:text-magic-red"
                    >
                      {l.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_PILL[l.priority] ?? PRIORITY_PILL.normal}`}
                    >
                      {l.priority}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_PILL[l.status] ?? "border-slate-200 bg-slate-100 text-slate-700"}`}
                    >
                      {LEAD_STATUS_LABEL[l.status as keyof typeof LEAD_STATUS_LABEL] ?? l.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-magic-ink/70">
                    {l.created_by_username ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-magic-ink/70">
                    {l.assigned_to_username ?? (
                      <span className="text-magic-ink/40">not distributed</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-magic-ink/50">
                    {new Date(l.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
        active
          ? "bg-magic-ink text-white shadow-sm"
          : "text-magic-ink/70 hover:bg-magic-soft"
      }`}
    >
      {children}
    </button>
  );
}
