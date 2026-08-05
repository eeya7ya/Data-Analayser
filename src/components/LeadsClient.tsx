"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { confirmDelete } from "@/lib/confirmDelete";
import { useRouter } from "next/navigation";
import { LEAD_STATUS_LABEL } from "@/lib/leadConstants";
import PageLoader from "@/components/PageLoader";
import Select from "@/components/Select";

/**
 * Leads list — master / detail (V1.4D).
 *
 * Design rules:
 *   1. NO AUTO-ROUTING. Clicking a row only selects it; the lead renders
 *      inline in the right pane. The full timeline page is an explicit
 *      "Open full lead" link.
 *   2. NO SILENT CLAIM. "Claim & file" routes to /leads/:id/assign, the
 *      dedicated page that forces a manual Company/Individual → Client →
 *      Project selection before the lead is taken off the queue.
 *   3. RESTRAINED PALETTE. White cards, one red accent, neutral greys.
 *      Priority is a thin left bar + small dot; status is muted text.
 *      No rainbow pills.
 *   4. DONE LEADS LEAVE. Once a quotation is sent to sales the lead is
 *      `completed_at`-stamped server-side and excluded from this queue
 *      (the ball is now in sales' court, tracked on the quotation).
 *
 * Toolbar: status tabs (presales), an age filter (Today / This week /
 * Older / All), a sort selector, and free-text search.
 */

interface Lead {
  id: number;
  ref: string;
  /** Reference of the quotation raised for this lead, once presales builds one. */
  quote_ref: string | null;
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
type AgeFilter = "all" | "today" | "week" | "older";
type SortKey = "newest" | "oldest" | "priority" | "updated";

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

// Priority accent — a single small dot / thin bar, not a full pill, so the
// list reads calm. Greys for body, red only for the active selection.
const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-amber-500",
  normal: "bg-slate-400",
  low: "bg-slate-300",
};

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

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
  const [age, setAge] = useState<AgeFilter>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [junk, setJunk] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [actBusy, setActBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (junk) params.set("view", "junk");
    else if (isPresales && tab !== "all") params.set("status", tab);

    fetch(`/api/leads?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { leads?: Lead[]; error?: string }) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          setLeads([]);
          setSelectedId(null);
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
  }, [tab, isPresales, junk, reloadKey]);

  // Silent background refresh — updates the list in place WITHOUT the loading
  // skeleton, so polling never makes the rows/icons flash. Used by the poll +
  // focus listeners below; transient errors are ignored (the list stays put).
  const silentRefresh = useCallback(async () => {
    const params = new URLSearchParams();
    if (junk) params.set("view", "junk");
    else if (isPresales && tab !== "all") params.set("status", tab);
    try {
      const r = await fetch(`/api/leads?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await r.json()) as { leads?: Lead[]; error?: string };
      if (!data.error && Array.isArray(data.leads)) setLeads(data.leads);
    } catch {
      /* keep the current list on a transient failure */
    }
  }, [tab, isPresales, junk]);

  // Keep the shared queue live: leads created, claimed or DELETED by other
  // users (e.g. sales removing an RFQ) won't push to this tab. Poll quietly
  // and refresh when the tab regains focus, so a deleted lead drops out on its
  // own — without the flicker a full reload would cause.
  useEffect(() => {
    const id = window.setInterval(() => void silentRefresh(), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void silentRefresh();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [silentRefresh]);

  // Lead junk actions. Move-to-junk / restore / delete-forever all hit the
  // leads API and then re-fetch so the row leaves (or returns to) the view.
  async function junkAction(
    leadId: number,
    action: "junk" | "restore" | "purge",
  ) {
    if (action === "purge" && !confirmDelete("Delete this lead forever?")) {
      return;
    }
    setActBusy(true);
    setError(null);
    try {
      let res: Response;
      if (action === "junk") {
        res = await fetch(`/api/leads/${leadId}`, { method: "DELETE" });
      } else if (action === "purge") {
        res = await fetch(`/api/leads/${leadId}?purge=1`, { method: "DELETE" });
      } else {
        res = await fetch(`/api/leads/${leadId}/restore`, { method: "POST" });
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSelectedId(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActBusy(false);
    }
  }

  // Filter (search + age) then sort — all client-side over a small queue.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const todayStart = startOfToday();
    const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;

    let list = leads.filter((l) => {
      if (q) {
        const hay = `${l.ref} ${l.title} ${l.description ?? ""} ${l.created_by_username ?? ""} ${l.assigned_to_username ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (age !== "all") {
        const t = Date.parse(l.created_at);
        if (!Number.isFinite(t)) return age === "older";
        if (age === "today" && t < todayStart) return false;
        if (age === "week" && t < weekStart) return false;
        if (age === "older" && t >= weekStart) return false;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      switch (sort) {
        case "oldest":
          return Date.parse(a.created_at) - Date.parse(b.created_at);
        case "updated":
          return Date.parse(b.updated_at) - Date.parse(a.updated_at);
        case "priority": {
          const pa = PRIORITY_RANK[a.priority] ?? 9;
          const pb = PRIORITY_RANK[b.priority] ?? 9;
          if (pa !== pb) return pa - pb;
          return Date.parse(b.created_at) - Date.parse(a.created_at);
        }
        case "newest":
        default:
          return Date.parse(b.created_at) - Date.parse(a.created_at);
      }
    });
    return list;
  }, [leads, query, age, sort]);

  // Keep a valid selection as the filtered list changes.
  useEffect(() => {
    setSelectedId((prev) => {
      if (prev && visible.some((l) => l.id === prev)) return prev;
      return visible[0]?.id ?? null;
    });
  }, [visible]);

  const counts = useMemo(() => {
    const todayStart = startOfToday();
    const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
    let today = 0;
    let week = 0;
    let older = 0;
    for (const l of leads) {
      const t = Date.parse(l.created_at);
      if (!Number.isFinite(t)) {
        older++;
        continue;
      }
      if (t >= todayStart) today++;
      if (t >= weekStart) week++;
      else older++;
    }
    return { today, week, older, total: leads.length };
  }, [leads]);

  const selected = useMemo(
    () => visible.find((l) => l.id === selectedId) ?? null,
    [visible, selectedId],
  );

  return (
    <div className="space-y-4">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {isPresales && !junk && (
              <SegTabs
                value={tab}
                onChange={(v) => setTab(v as Tab)}
                options={[
                  { value: "new", label: "Unclaimed" },
                  { value: "in_progress", label: "In progress" },
                  { value: "all", label: "All" },
                ]}
              />
            )}
            {/* Junk toggle — presales (and the lead creator) triage noise /
                duplicates here; the live queue and junk are mutually
                exclusive views. */}
            <button
              type="button"
              onClick={() => {
                setJunk((v) => !v);
                setSelectedId(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
                junk
                  ? "border-magic-red bg-magic-red text-white"
                  : "border-magic-border bg-white text-magic-ink/65 hover:bg-magic-soft"
              }`}
            >
              {junk ? "← Back to queue" : "Junk"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ref, title, owner…"
              className="w-52 rounded-lg border border-magic-border bg-white px-3 py-1.5 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
            />
            <Select
              value={sort}
              onChange={(next) => setSort(next as SortKey)}
              className="rounded-lg border border-magic-border bg-white px-2.5 py-1.5 text-sm text-magic-ink/80 focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
              title="Sort"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="priority">Priority</option>
              <option value="updated">Recently updated</option>
            </Select>
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

        {/* Age filter — Today / This week / Older / All */}
        <SegTabs
          value={age}
          onChange={(v) => setAge(v as AgeFilter)}
          subtle
          options={[
            { value: "all", label: "All", badge: counts.total },
            { value: "today", label: "Today", badge: counts.today },
            { value: "week", label: "This week", badge: counts.week },
            { value: "older", label: "Older", badge: counts.older },
          ]}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* ── Master + detail ─────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,400px)]">
        <div className="space-y-2">
          {loading ? (
            <div className="rounded-2xl border border-magic-border bg-white p-6 shadow-sm">
              <PageLoader label="Loading leads…" />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              tab={tab}
              age={age}
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

        <div className="lg:sticky lg:top-4 lg:self-start">
          {selected ? (
            <LeadDetailPane
              lead={selected}
              isPresales={isPresales}
              mine={selected.assigned_to_id === userId}
              junk={junk}
              actBusy={actBusy}
              onAssign={() => router.push(`/leads/${selected.id}/assign`)}
              onJunk={() => void junkAction(selected.id, "junk")}
              onRestore={() => void junkAction(selected.id, "restore")}
              onPurge={() => void junkAction(selected.id, "purge")}
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
      className={`group flex w-full items-stretch gap-3 overflow-hidden rounded-xl border bg-white text-left transition-all ${
        selected
          ? "border-magic-red shadow-sm ring-1 ring-magic-red/20"
          : "border-magic-border hover:border-magic-ink/20 hover:shadow-sm"
      }`}
    >
      <span
        className={`w-1 flex-shrink-0 ${PRIORITY_DOT[lead.priority] ?? PRIORITY_DOT.normal}`}
      />
      <div className="flex flex-1 flex-col gap-1 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-magic-ink/55">
            {lead.quote_ref ?? "No reference yet"}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-magic-ink/55">
            <span
              className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[lead.priority] ?? PRIORITY_DOT.normal}`}
            />
            {lead.priority}
          </span>
          <span className="text-magic-ink/30">·</span>
          <span className="text-[11px] text-magic-ink/55">
            {LEAD_STATUS_LABEL[lead.status as keyof typeof LEAD_STATUS_LABEL] ?? lead.status}
          </span>
          <span className="ml-auto text-[10px] text-magic-ink/40">
            {relative(lead.created_at)}
            {updated ? ` · upd ${relative(lead.updated_at)}` : ""}
          </span>
        </div>
        <div className="text-sm font-semibold text-magic-ink">
          {lead.title}
        </div>
        {lead.description && (
          <p className="line-clamp-1 text-xs text-magic-ink/55">
            {lead.description}
          </p>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-magic-ink/55">
          <span className="inline-flex items-center gap-1.5">
            <Avatar name={lead.created_by_username} muted />
            <span>{lead.created_by_username ?? "—"}</span>
          </span>
          <span className="text-magic-ink/30">→</span>
          {lead.assigned_to_username ? (
            <span className="inline-flex items-center gap-1.5">
              <Avatar name={lead.assigned_to_username} accent={mine} />
              <span className={mine ? "font-semibold text-magic-red" : ""}>
                {mine ? "You" : lead.assigned_to_username}
              </span>
            </span>
          ) : (
            <span className="text-magic-ink/40">Unclaimed</span>
          )}
          {lead.requested_timeline_at && (
            <span className="ml-auto text-[10px] text-magic-ink/45">
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
  junk,
  actBusy,
  onAssign,
  onJunk,
  onRestore,
  onPurge,
}: {
  lead: Lead;
  isPresales: boolean;
  mine: boolean;
  junk: boolean;
  actBusy: boolean;
  onAssign: () => void;
  onJunk: () => void;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const updated = lead.updated_at && lead.updated_at !== lead.created_at;
  const claimable =
    !junk && isPresales && lead.status === "new" && !lead.assigned_to_id;
  // Presales can junk an active lead; the creator can too. (Server
  // re-checks; this just governs button visibility.)
  const canJunk = !junk && isPresales;
  return (
    <div className="rounded-2xl border border-magic-border bg-white shadow-sm">
      <div className="border-b border-magic-border/60 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-magic-ink/55">
            {lead.quote_ref ?? "No reference yet"}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-magic-ink/55">
            <span
              className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[lead.priority] ?? PRIORITY_DOT.normal}`}
            />
            {lead.priority}
          </span>
          <span className="text-magic-ink/30">·</span>
          <span className="text-[11px] text-magic-ink/55">
            {LEAD_STATUS_LABEL[lead.status as keyof typeof LEAD_STATUS_LABEL] ?? lead.status}
          </span>
        </div>
        <h3 className="mt-1 text-lg font-bold text-magic-ink">{lead.title}</h3>
        <p className="mt-0.5 text-[11px] text-magic-ink/45">
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
          <DetailField label="Opened by" value={lead.created_by_username ?? "—"} />
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
          <div className="rounded-xl border border-dashed border-magic-border bg-magic-soft/30 px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-magic-ink/55">
              {lead.project_id ? "Presales filing" : "Quick reference (from sales)"}
            </div>
            <p className="mt-1 text-xs text-magic-ink/70">
              {lead.project_id
                ? "Filed under a presales project. Open the workspace to keep working."
                : "Sales attached these hints when opening the lead — context only. The presales tree is set when you claim & file."}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {junk ? (
            <>
              <button
                type="button"
                onClick={onRestore}
                disabled={actBusy}
                className="rounded-lg bg-magic-red px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90 disabled:opacity-50"
              >
                Restore
              </button>
              <button
                type="button"
                onClick={onPurge}
                disabled={actBusy}
                className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Delete forever
              </button>
            </>
          ) : (
            <>
              {claimable && (
                <button
                  type="button"
                  onClick={onAssign}
                  className="rounded-lg bg-magic-red px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90"
                >
                  Claim &amp; file →
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
              {canJunk && (
                <button
                  type="button"
                  onClick={onJunk}
                  disabled={actBusy}
                  className="ml-auto rounded-lg border border-magic-border px-3 py-2 text-xs font-semibold text-magic-ink/60 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300 disabled:opacity-50"
                  title="Move this lead to junk (restorable)"
                >
                  Move to junk
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Avatar({
  name,
  muted,
  accent,
}: {
  name: string | null | undefined;
  muted?: boolean;
  accent?: boolean;
}) {
  const tone = accent
    ? "bg-magic-red/15 text-magic-red"
    : muted
      ? "bg-slate-100 text-slate-600"
      : "bg-slate-100 text-slate-600";
  return (
    <span
      className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${tone}`}
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
  age,
  isPresales,
  hasQuery,
}: {
  tab: Tab;
  age: AgeFilter;
  isPresales: boolean;
  hasQuery: boolean;
}) {
  const msg = hasQuery
    ? "Nothing matches that search."
    : age !== "all"
      ? `No leads in this time range.`
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

function SegTabs({
  value,
  onChange,
  options,
  subtle = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string; badge?: number }>;
  subtle?: boolean;
}) {
  return (
    <div
      className={`inline-flex items-center gap-1 rounded-xl border border-magic-border bg-white p-1 ${subtle ? "" : "shadow-sm"}`}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              active
                ? subtle
                  ? "bg-magic-soft text-magic-ink"
                  : "bg-magic-ink text-white shadow-sm"
                : "text-magic-ink/65 hover:bg-magic-soft"
            }`}
          >
            {o.label}
            {typeof o.badge === "number" && (
              <span
                className={`inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                  active && !subtle
                    ? "bg-white/20 text-white"
                    : "bg-magic-soft text-magic-ink/60"
                }`}
              >
                {o.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
