"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LEAD_STATUS_LABEL } from "@/lib/leadConstants";
import PageLoader from "@/components/PageLoader";

/**
 * Leads list — master / detail layout (V1.4D).
 *
 * Two design rules drive this page:
 *   1. NO AUTO-ROUTING. Clicking a row never navigates somewhere else.
 *      It just selects the row; the lead's data renders in the right
 *      pane (or below, on narrow screens). Sales sees their own; presales
 *      sees the shared queue.
 *   2. NO SILENT CLAIM. The "Claim & file" button is the only path to
 *      ownership and it goes to the dedicated /leads/:id/assign page,
 *      which forces the Company / Individual → Client → Project tree
 *      before the lead is taken off the queue. No more single-click
 *      claim that strands an unfiled lead.
 *
 * Backend: powered by /api/leads with all the data we need to render
 * inline (title, description, priority, status, opened-by, working-on,
 * created_at, updated_at, requested_timeline_at, project_id). Lead
 * detail and timeline still live at /leads/[id] for users who want the
 * full history; this page links to it as "Open full lead" rather than
 * making it a side-effect of clicking a row.
 */

interface Lead {
  id: number;
  ref: string;
  title: string;
  description: string | null;
  source: string | null;
  priority: string;
  status: string;
  created_by: number | null;
  created_by_username: string | null;
  requested_timeline_at: string | null;
  assigned_to_id: number | null;
  assigned_to_username: string | null;
  company_id: number | null;
  folder_id: number | null;
  project_id: number | null;
  created_at: string;
  updated_at: string;
}

type Tab = "new" | "in_progress" | "all";

const PRIORITY_BAR: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-400",
  normal: "bg-sky-400",
  low: "bg-slate-300",
};

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

function relative(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const delta = Date.now() - t;
  if (delta < 0) return "just now";
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function LeadsClient({
  canCreate,
  isPresales,
  userId,
}: {
  canCreate: boolean;
  isPresales: boolean;
  userId: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(isPresales ? "new" : "all");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");

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
          setSelectedId(null);
        } else {
          const list = data.leads ?? [];
          setLeads(list);
          // Preserve selection across re-fetches when the lead is still
          // in the list; otherwise default to the first one so the right
          // pane is never empty when there's something to show.
          setSelectedId((prev) => {
            if (prev && list.some((l) => l.id === prev)) return prev;
            return list[0]?.id ?? null;
          });
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
  }, [tab, isPresales]);

  // Client-side text filter — small queue so a SQL trip per keystroke
  // would be wasteful.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter(
      (l) =>
        l.ref.toLowerCase().includes(q) ||
        l.title.toLowerCase().includes(q) ||
        (l.description ?? "").toLowerCase().includes(q) ||
        (l.created_by_username ?? "").toLowerCase().includes(q) ||
        (l.assigned_to_username ?? "").toLowerCase().includes(q),
    );
  }, [leads, query]);

  // Smart counts for the tab strip — driven by the same fetch result
  // for the "all" tab so the numbers are exact. For "new" /
  // "in_progress" we only have the filtered list so we count what we've
  // got (the SQL already scopes by status).
  const stats = useMemo(() => {
    const unclaimed = leads.filter((l) => l.status === "new").length;
    const inProgress = leads.filter((l) => l.status === "in_progress").length;
    const mine = leads.filter(
      (l) => l.assigned_to_id === userId && l.status === "in_progress",
    ).length;
    const stale = leads.filter((l) => {
      if (l.status !== "new") return false;
      const t = Date.parse(l.created_at);
      if (!Number.isFinite(t)) return false;
      return Date.now() - t > 24 * 60 * 60 * 1000;
    }).length;
    return { unclaimed, inProgress, mine, stale, total: leads.length };
  }, [leads, userId]);

  const selected = useMemo(
    () => visible.find((l) => l.id === selectedId) ?? null,
    [visible, selectedId],
  );

  return (
    <div className="space-y-4">
      {/* ── Stats strip ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label={isPresales ? "Unclaimed" : "Open"}
          value={stats.unclaimed}
          tone="sky"
        />
        <StatCard
          label={isPresales ? "In progress" : "Being worked"}
          value={stats.inProgress}
          tone="emerald"
        />
        <StatCard
          label={isPresales ? "Yours" : "Total opened"}
          value={isPresales ? stats.mine : stats.total}
          tone="rose"
        />
        <StatCard
          label="Stale > 24h"
          value={stats.stale}
          tone={stats.stale > 0 ? "amber" : "slate"}
        />
      </div>

      {/* ── Filter row ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {isPresales ? (
          <div className="inline-flex rounded-xl border border-magic-border bg-white p-1 text-sm shadow-sm">
            <TabButton active={tab === "new"} onClick={() => setTab("new")}>
              Unclaimed
              {tab !== "new" && stats.unclaimed > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-magic-red px-1 text-[10px] font-bold text-white">
                  {stats.unclaimed}
                </span>
              )}
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

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ref, title, owner…"
            className="w-56 rounded-lg border border-magic-border bg-white px-3 py-1.5 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
          />
          {canCreate && (
            <Link
              href="/leads/new"
              className="rounded-lg bg-magic-red px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-magic-red/90"
            >
              + New lead
            </Link>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* ── Master + detail grid ────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
        {/* List */}
        <div className="space-y-2">
          {loading ? (
            <div className="rounded-2xl border border-magic-border bg-white p-6 shadow-sm">
              <PageLoader label="Loading leads…" />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              tab={tab}
              isPresales={isPresales}
              hasQuery={query.trim().length > 0}
            />
          ) : (
            visible.map((lead) => (
              <LeadRowCard
                key={lead.id}
                lead={lead}
                selected={lead.id === selectedId}
                mine={lead.assigned_to_id === userId}
                onSelect={() => setSelectedId(lead.id)}
              />
            ))
          )}
        </div>

        {/* Detail pane */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          {selected ? (
            <LeadDetailPane
              lead={selected}
              isPresales={isPresales}
              mine={selected.assigned_to_id === userId}
              onAssign={() => router.push(`/leads/${selected.id}/assign`)}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-magic-border bg-white/60 p-8 text-center text-sm text-magic-ink/55">
              Pick a lead on the left to see its details here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LeadRowCard({
  lead,
  selected,
  mine,
  onSelect,
}: {
  lead: Lead;
  selected: boolean;
  mine: boolean;
  onSelect: () => void;
}) {
  const updated = lead.updated_at && lead.updated_at !== lead.created_at;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group flex w-full items-stretch gap-3 overflow-hidden rounded-2xl border bg-white text-left shadow-sm transition-all ${
        selected
          ? "border-magic-red shadow-md ring-2 ring-magic-red/20"
          : "border-magic-border hover:border-magic-red/40 hover:shadow-md"
      }`}
    >
      <span
        className={`w-1.5 flex-shrink-0 ${PRIORITY_BAR[lead.priority] ?? PRIORITY_BAR.normal}`}
      />
      <div className="flex flex-1 flex-col gap-1.5 px-3 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] font-semibold text-magic-red">
            {lead.ref}
          </span>
          <span
            className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_PILL[lead.priority] ?? PRIORITY_PILL.normal}`}
          >
            {lead.priority}
          </span>
          <span
            className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_PILL[lead.status] ?? "border-slate-200 bg-slate-100 text-slate-700"}`}
          >
            {LEAD_STATUS_LABEL[lead.status as keyof typeof LEAD_STATUS_LABEL] ?? lead.status}
          </span>
          <span className="ml-auto text-[10px] text-magic-ink/40">
            Opened {relative(lead.created_at)}
            {updated ? ` · updated ${relative(lead.updated_at)}` : ""}
          </span>
        </div>
        <div className="text-sm font-semibold text-magic-ink">
          {lead.title}
        </div>
        {lead.description && (
          <p className="line-clamp-1 text-xs text-magic-ink/60">
            {lead.description}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-magic-ink/60">
          <span className="inline-flex items-center gap-1.5">
            <Avatar
              name={lead.created_by_username}
              tone="slate"
              title={`Opened by ${lead.created_by_username ?? "—"}`}
            />
            <span>{lead.created_by_username ?? "—"}</span>
          </span>
          <span className="text-magic-ink/30">→</span>
          {lead.assigned_to_username ? (
            <span className="inline-flex items-center gap-1.5">
              <Avatar
                name={lead.assigned_to_username}
                tone={mine ? "rose" : "emerald"}
                title={`Working on it: ${lead.assigned_to_username}`}
              />
              <span
                className={`font-semibold ${mine ? "text-magic-red" : "text-emerald-700"}`}
              >
                {mine ? "You" : lead.assigned_to_username}
              </span>
            </span>
          ) : (
            <span className="rounded-full border border-dashed border-magic-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-magic-ink/45">
              Unclaimed
            </span>
          )}
          {lead.requested_timeline_at && (
            <span className="ml-auto inline-flex items-center rounded-full border border-magic-border bg-magic-soft/50 px-2 py-0.5 text-[10px]">
              Needed by{" "}
              {new Date(lead.requested_timeline_at).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function LeadDetailPane({
  lead,
  isPresales,
  mine,
  onAssign,
}: {
  lead: Lead;
  isPresales: boolean;
  mine: boolean;
  onAssign: () => void;
}) {
  const updated = lead.updated_at && lead.updated_at !== lead.created_at;
  const claimable = isPresales && lead.status === "new" && !lead.assigned_to_id;
  return (
    <div className="rounded-2xl border border-magic-border bg-white shadow-sm">
      <div className="border-b border-magic-border/60 bg-gradient-to-br from-magic-soft/60 via-white to-white px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] font-semibold text-magic-red">
            {lead.ref}
          </span>
          <span
            className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_PILL[lead.status] ?? "border-slate-200 bg-slate-100 text-slate-700"}`}
          >
            {LEAD_STATUS_LABEL[lead.status as keyof typeof LEAD_STATUS_LABEL] ?? lead.status}
          </span>
          <span
            className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_PILL[lead.priority] ?? PRIORITY_PILL.normal}`}
          >
            {lead.priority}
          </span>
        </div>
        <h3 className="mt-1 text-lg font-bold text-magic-ink">{lead.title}</h3>
        <p className="mt-1 text-[11px] text-magic-ink/45">
          Opened {relative(lead.created_at)}
          {updated ? ` · updated ${relative(lead.updated_at)}` : ""}
        </p>
      </div>

      <div className="space-y-4 px-5 py-4">
        {lead.description ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-magic-ink/85">
            {lead.description}
          </p>
        ) : (
          <p className="text-sm italic text-magic-ink/45">
            No description was attached to this request.
          </p>
        )}

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <DetailField
            label="Opened by"
            value={lead.created_by_username ?? "—"}
          />
          <DetailField
            label="Working on it"
            value={
              lead.assigned_to_username
                ? mine
                  ? "You"
                  : lead.assigned_to_username
                : "Unclaimed"
            }
          />
          <DetailField label="Source" value={lead.source ?? "—"} />
          <DetailField
            label="Needed by"
            value={
              lead.requested_timeline_at
                ? new Date(lead.requested_timeline_at).toLocaleDateString()
                : "—"
            }
          />
        </dl>

        {(lead.company_id || lead.folder_id || lead.project_id) && (
          <div className="rounded-xl border border-dashed border-magic-border/80 bg-magic-soft/30 px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-magic-ink/55">
              {lead.project_id ? "Presales filing" : "Quick reference (from sales)"}
            </div>
            <p className="mt-1 text-xs text-magic-ink/75">
              {lead.project_id
                ? "This lead is already filed under a presales project. Open the workspace to keep working."
                : "Sales attached these hints when opening the lead — they're for context only. The presales tree is set when you claim & file."}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {claimable && (
            <button
              type="button"
              onClick={onAssign}
              className="rounded-lg bg-magic-red px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90"
            >
              Claim & file →
            </button>
          )}
          {isPresales && mine && lead.folder_id && (
            <Link
              href={`/folder/${lead.folder_id}`}
              className="rounded-lg bg-magic-red px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90"
            >
              Open client workspace →
            </Link>
          )}
          <Link
            href={`/leads/${lead.id}`}
            className="rounded-lg border border-magic-border px-3 py-2 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft"
          >
            Open full lead
          </Link>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "sky" | "emerald" | "rose" | "amber" | "slate";
}) {
  const tones: Record<typeof tone, string> = {
    sky: "border-sky-200 bg-sky-50/70 text-sky-900",
    emerald: "border-emerald-200 bg-emerald-50/70 text-emerald-900",
    rose: "border-magic-red/30 bg-magic-red/5 text-magic-red",
    amber: "border-amber-300 bg-amber-50 text-amber-900",
    slate: "border-magic-border bg-white text-magic-ink/70",
  };
  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${tones[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold leading-none">{value}</div>
    </div>
  );
}

function Avatar({
  name,
  tone,
  title,
}: {
  name: string | null | undefined;
  tone: "slate" | "rose" | "emerald";
  title?: string;
}) {
  const tones: Record<typeof tone, string> = {
    slate: "bg-slate-200 text-slate-700",
    rose: "bg-magic-red/15 text-magic-red",
    emerald: "bg-emerald-100 text-emerald-800",
  };
  return (
    <span
      title={title}
      className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${tones[tone]}`}
    >
      {initials(name)}
    </span>
  );
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-magic-ink/50">
        {label}
      </dt>
      <dd className="text-sm font-medium text-magic-ink">{value}</dd>
    </div>
  );
}

function EmptyState({
  tab,
  isPresales,
  hasQuery,
}: {
  tab: Tab;
  isPresales: boolean;
  hasQuery: boolean;
}) {
  const msg = hasQuery
    ? "Nothing matches that search."
    : !isPresales
      ? "You haven't opened any leads yet."
      : tab === "new"
        ? "No unclaimed leads — the queue is clear."
        : tab === "in_progress"
          ? "No leads are being worked right now."
          : "No leads yet.";
  return (
    <div className="rounded-2xl border border-dashed border-magic-border bg-white p-10 text-center text-sm text-magic-ink/55">
      {msg}
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
      className={`inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
        active
          ? "bg-magic-ink text-white shadow-sm"
          : "text-magic-ink/70 hover:bg-magic-soft"
      }`}
    >
      {children}
    </button>
  );
}
