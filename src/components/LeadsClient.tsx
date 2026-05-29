"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LEAD_STATUS_LABEL } from "@/lib/leadConstants";

interface Lead {
  id: number;
  ref: string;
  title: string;
  priority: string;
  status: string;
  created_by_username: string | null;
  assigned_to_id: number | null;
  assigned_to_username: string | null;
  created_at: string;
}

type Tab = "new" | "in_progress" | "all";

const PRIORITY_PILL: Record<string, string> = {
  urgent: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  normal: "bg-slate-100 text-slate-800 border-slate-200",
  low: "bg-slate-50 text-slate-500 border-slate-200",
};

const STATUS_PILL: Record<string, string> = {
  new: "bg-sky-100 text-sky-800 border-sky-200",
  in_progress: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export default function LeadsClient({
  canCreate,
  isPresales,
  userId,
}: {
  canCreate: boolean;
  isPresales: boolean;
  userId: number;
}) {
  // Presales triage the shared queue by claim-state; sales just see their
  // own opened leads with no tab framing.
  const [tab, setTab] = useState<Tab>(isPresales ? "new" : "all");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (isPresales && tab !== "all") params.set("status", tab);

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
  }, [tab, isPresales, tick]);

  async function claim(leadId: number) {
    setClaiming(leadId);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim" }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setClaiming(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {isPresales ? (
          <div className="inline-flex rounded-xl border border-magic-border bg-white p-1 text-sm shadow-sm">
            <TabButton active={tab === "new"} onClick={() => setTab("new")}>
              Unclaimed
            </TabButton>
            <TabButton
              active={tab === "in_progress"}
              onClick={() => setTab("in_progress")}
            >
              In progress
            </TabButton>
            <TabButton active={tab === "all"} onClick={() => setTab("all")}>
              All
            </TabButton>
          </div>
        ) : (
          <span />
        )}
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
              <th className="px-3 py-2 font-semibold">Working on it</th>
              <th className="px-3 py-2 font-semibold">Opened</th>
              {isPresales && <th className="px-3 py-2 font-semibold" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-magic-border/40">
            {loading && (
              <tr>
                <td colSpan={isPresales ? 8 : 7} className="px-3 py-6 text-center text-magic-ink/50">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && leads.length === 0 && (
              <tr>
                <td colSpan={isPresales ? 8 : 7} className="px-3 py-8 text-center text-magic-ink/50">
                  {!isPresales
                    ? "You haven't opened any leads yet."
                    : tab === "new"
                      ? "No unclaimed leads — the queue is clear."
                      : tab === "in_progress"
                        ? "No leads are being worked right now."
                        : "No leads yet."}
                </td>
              </tr>
            )}
            {!loading &&
              leads.map((l) => {
                const mine = l.assigned_to_id === userId;
                return (
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
                    <td className="px-3 py-2 text-xs">
                      {l.assigned_to_username ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold ${
                            mine
                              ? "border-magic-red/30 bg-magic-red/10 text-magic-red"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {mine ? "You" : l.assigned_to_username}
                        </span>
                      ) : (
                        <span className="text-magic-ink/40">Unclaimed</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-magic-ink/50">
                      {new Date(l.created_at).toLocaleDateString()}
                    </td>
                    {isPresales && (
                      <td className="px-3 py-2 text-right">
                        {!l.assigned_to_id && (
                          <button
                            onClick={() => void claim(l.id)}
                            disabled={claiming === l.id}
                            className="rounded-lg bg-magic-red px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-magic-red/90 disabled:opacity-50"
                          >
                            {claiming === l.id ? "Claiming…" : "Claim"}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
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
