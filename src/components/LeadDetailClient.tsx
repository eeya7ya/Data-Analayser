"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LEAD_STATUS_LABEL } from "@/lib/leadConstants";
import PageLoader from "@/components/PageLoader";

/**
 * Lead detail surface, V1.4D.
 *
 * Two changes vs. the prior revision:
 *   1. The "Linked CRM records" panel that surfaced the sales-side hints
 *      as the lead's active linkage was removed. Sales-side hints are
 *      now shown as a clearly-labelled "Quick reference (from sales)"
 *      box — they exist for orientation, not as the presales tree.
 *   2. The single "Claim this lead" button used to do an instant
 *      claim with no choices. Now it routes to the dedicated
 *      /leads/:id/assign page, which forces the presales author to
 *      pick (or create) the Company-or-Individual → Client → Project
 *      tree the lead will be filed under before the claim happens.
 *      No modal, no silent claim — one explicit page, one round-trip
 *      via POST /api/leads/:id/assign-and-claim, atomic on the server.
 */

interface LeadRow {
  id: number;
  ref: string;
  title: string;
  description: string | null;
  source: string | null;
  priority: string;
  status: string;
  created_by: number | null;
  created_by_username: string | null;
  created_by_name: string | null;
  requested_timeline_at: string | null;
  assigned_to_id: number | null;
  assigned_to_username: string | null;
  assigned_to_name: string | null;
  assigned_at: string | null;
  company_id: number | null;
  folder_id: number | null;
  project_id: number | null;
  company_name: string | null;
  folder_name: string | null;
  project_name: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  created_at: string;
  updated_at: string;
}

interface LeadEvent {
  id: number;
  verb: string;
  message: string | null;
  meta_json: Record<string, unknown>;
  created_at: string;
  actor_username: string | null;
  actor_name: string | null;
}

interface CurrentUser {
  id: number;
  role: string;
  module_roles: Array<{ module: string; role: string }>;
}

const PRIORITY_TONE: Record<string, string> = {
  low: "border-slate-200 bg-slate-50 text-slate-700",
  normal: "border-sky-200 bg-sky-50 text-sky-800",
  high: "border-amber-300 bg-amber-50 text-amber-800",
  urgent: "border-red-300 bg-red-50 text-red-800",
};

const STATUS_TONE: Record<string, string> = {
  new: "border-sky-200 bg-sky-50 text-sky-800",
  in_progress: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

/** Map of verb → tailwind background for the timeline icon dot. */
const VERB_TONE: Record<string, string> = {
  created: "bg-sky-500",
  claimed: "bg-emerald-500",
  claimed_with_assignment: "bg-emerald-500",
  released: "bg-amber-500",
  reclaimed: "bg-emerald-500",
  quotation_sent_to_sales: "bg-magic-red",
  quotation_accepted: "bg-emerald-500",
  quotation_change_requested: "bg-amber-500",
};

const VERB_LABEL: Record<string, string> = {
  created: "Opened",
  claimed: "Claimed",
  claimed_with_assignment: "Claimed & filed",
  released: "Released",
  reclaimed: "Re-claimed",
  quotation_sent_to_sales: "Quotation sent",
  quotation_accepted: "Quotation accepted",
  quotation_change_requested: "Change requested",
};

function relative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
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

export default function LeadDetailClient({ leadId }: { leadId: number }) {
  const router = useRouter();
  const [lead, setLead] = useState<LeadRow | null>(null);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const goToAssign = useCallback(
    () => router.push(`/leads/${leadId}/assign`),
    [router, leadId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/leads/${leadId}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/auth/me`, { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([leadData, meData]) => {
        if (cancelled) return;
        if (leadData.error) {
          setError(leadData.error);
        } else {
          setLead(leadData.lead);
          setEvents(leadData.events ?? []);
        }
        const u = meData?.user ?? null;
        if (u) {
          setMe({
            id: Number(u.id),
            role: String(u.role),
            module_roles: meData.module_roles ?? [],
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
  }, [leadId, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const flags = useMemo(() => {
    if (!me) return null;
    const isAdmin = me.role === "admin";
    const has = (m: string, r: string) =>
      isAdmin || me.module_roles.some((g) => g.module === m && g.role === r);
    return {
      isAdmin,
      isPresales: has("crm", "presales") || has("crm", "presales_manager"),
    };
  }, [me]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-magic-border bg-white p-8 shadow-sm">
        <PageLoader label="Loading the lead…" />
      </div>
    );
  }
  if (error || !lead || !me || !flags) {
    // A 404 from /api/leads/:id ("not found") just means this lead no longer
    // exists — it was purged, or converted into a company/project and cleared
    // from the queue. Show that plainly instead of a cryptic "not found".
    const message =
      error === "not found"
        ? "This lead no longer exists — it may have been converted or removed from the queue."
        : (error ?? "Lead not available.");
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        {message}
      </div>
    );
  }

  const assigned = lead.assigned_to_name || lead.assigned_to_username;
  const isOwner = me.id === lead.assigned_to_id;
  const isUnclaimed = lead.status === "new" || lead.assigned_to_id === null;
  const canClaim = flags.isPresales || flags.isAdmin;
  const contactName = [lead.contact_first_name, lead.contact_last_name]
    .filter(Boolean)
    .join(" ");

  // The presales-side filing — set by the claim flow, surfaced as the
  // active linkage to the user. We treat any lead that has a project_id
  // as filed; everything before that is just sales-side reference.
  const presalesFiled = Boolean(lead.project_id && lead.folder_id);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {/* ── Lead header card ─────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-2xl border border-magic-border bg-white shadow-sm">
          <div className="border-b border-magic-border/60 bg-gradient-to-br from-magic-soft/60 via-white to-white px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold tracking-wide text-magic-red">
                    {lead.ref}
                  </span>
                  <span className="text-[11px] text-magic-ink/40">
                    Opened {relative(lead.created_at)}
                  </span>
                  {lead.updated_at && lead.updated_at !== lead.created_at && (
                    <span className="text-[11px] text-magic-ink/40">
                      · last update {relative(lead.updated_at)}
                    </span>
                  )}
                </div>
                <h2 className="mt-1 text-2xl font-bold text-magic-ink">
                  {lead.title}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${PRIORITY_TONE[lead.priority] ?? PRIORITY_TONE.normal}`}
                >
                  {lead.priority}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_TONE[lead.status] ?? "border-slate-200 bg-slate-50 text-slate-700"}`}
                >
                  {LEAD_STATUS_LABEL[lead.status as keyof typeof LEAD_STATUS_LABEL] ?? lead.status}
                </span>
              </div>
            </div>
          </div>

          <div className="px-6 py-5">
            {lead.description ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-magic-ink/85">
                {lead.description}
              </p>
            ) : (
              <p className="text-sm italic text-magic-ink/45">
                No description was attached to this request.
              </p>
            )}

            <dl className="mt-5 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <Field label="Priority" value={lead.priority} />
              <Field label="Source" value={lead.source ?? "—"} />
              <Field
                label="Opened by"
                value={lead.created_by_name || lead.created_by_username || "—"}
              />
              <Field
                label="Requested response by"
                value={
                  lead.requested_timeline_at
                    ? new Date(lead.requested_timeline_at).toLocaleDateString()
                    : "—"
                }
              />
              <Field label="Working on it" value={assigned || "Unclaimed"} />
              <Field
                label="Claimed"
                value={
                  lead.assigned_at
                    ? new Date(lead.assigned_at).toLocaleDateString()
                    : "—"
                }
              />
            </dl>

            {/* Quick reference — sales-side hints, surfaced for context.
                Deliberately NOT shown as the active linkage; the presales
                tree below is the canonical filing. */}
            {(lead.company_name || lead.folder_name || contactName) && (
              <div className="mt-5 rounded-xl border border-dashed border-magic-border/80 bg-magic-soft/30 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-magic-ink/55">
                    Quick reference (from sales)
                  </span>
                  <span className="text-[10px] text-magic-ink/40">
                    For context — presales files this lead under its own
                    tree.
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                  {lead.company_name && !presalesFiled && (
                    <ReferenceItem
                      label="Company hint"
                      value={lead.company_name}
                    />
                  )}
                  {lead.folder_name && !presalesFiled && (
                    <ReferenceItem
                      label="Client hint"
                      value={lead.folder_name}
                    />
                  )}
                  {contactName && (
                    <ReferenceItem label="Contact" value={contactName} />
                  )}
                  {!lead.company_name && !lead.folder_name && contactName && (
                    <ReferenceItem
                      label="No CRM hints"
                      value="Sales opened this without linking a client."
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Timeline card ────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-magic-border bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-baseline justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wide text-magic-ink/70">
              Timeline
            </h3>
            <span className="text-[11px] text-magic-ink/40">
              {events.length} event{events.length === 1 ? "" : "s"}
            </span>
          </div>
          {events.length === 0 ? (
            <p className="rounded-lg border border-dashed border-magic-border/70 px-4 py-6 text-center text-sm text-magic-ink/45">
              No activity yet.
            </p>
          ) : (
            <ol className="relative space-y-4 border-l border-magic-border/60 pl-5">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span
                    className={`absolute -left-[1.6rem] top-1 h-3 w-3 rounded-full ring-4 ring-white ${VERB_TONE[e.verb] ?? "bg-magic-ink/40"}`}
                  />
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-magic-ink/75">
                      {VERB_LABEL[e.verb] ?? e.verb.replace(/_/g, " ")}
                    </span>
                    <span className="text-[11px] text-magic-ink/40">
                      {new Date(e.created_at).toLocaleString()}
                    </span>
                    <span className="text-[11px] text-magic-ink/40">
                      · {relative(e.created_at)}
                    </span>
                  </div>
                  {e.message && (
                    <p className="mt-1 text-sm text-magic-ink/80">{e.message}</p>
                  )}
                  {e.actor_username && (
                    <p className="mt-0.5 text-[11px] text-magic-ink/45">
                      by {e.actor_name || e.actor_username}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* ── Right rail ───────────────────────────────────────────────── */}
      <div className="space-y-4">
        <OwnershipPanel
          lead={lead}
          assigned={assigned}
          isOwner={isOwner}
          isUnclaimed={isUnclaimed}
          canClaim={canClaim}
          isAdmin={flags.isAdmin}
          onChanged={reload}
          onClaimRequested={goToAssign}
        />

        {lead.status === "in_progress" && (isOwner || flags.isAdmin) && (
          <PresalesFilingPanel lead={lead} onReassign={goToAssign} />
        )}
      </div>
    </div>
  );
}

/**
 * Ownership card. The "Claim this lead" button no longer talks to the API
 * directly — it routes to /leads/:id/assign so the presales author has to
 * pick a tree before the claim is recorded. Release still goes
 * straight through (releasing back to the queue doesn't need a tree).
 */
function OwnershipPanel({
  lead,
  assigned,
  isOwner,
  isUnclaimed,
  canClaim,
  isAdmin,
  onChanged,
  onClaimRequested,
}: {
  lead: LeadRow;
  assigned: string | null;
  isOwner: boolean;
  isUnclaimed: boolean;
  canClaim: boolean;
  isAdmin: boolean;
  onChanged: () => void;
  onClaimRequested: () => void;
}) {
  const [busy, setBusy] = useState<"release" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function release() {
    setBusy("release");
    setErr(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release" }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-magic-border bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-magic-ink/70">
        Ownership
      </h3>

      {isUnclaimed ? (
        <>
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
            This lead is unclaimed and sitting in the shared queue.
          </p>
          {canClaim ? (
            <button
              type="button"
              onClick={onClaimRequested}
              className="mt-3 w-full rounded-lg bg-magic-red px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90"
            >
              Claim & file this lead
            </button>
          ) : (
            <p className="mt-3 text-xs italic text-magic-ink/50">
              Waiting for a presales person to claim this lead.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {isOwner ? (
              <>You&apos;re working on this lead.</>
            ) : (
              <>
                Being worked on by{" "}
                <span className="font-semibold">{assigned || "a presales member"}</span>
                {lead.assigned_at && (
                  <> · since {new Date(lead.assigned_at).toLocaleDateString()}</>
                )}
                .
              </>
            )}
          </p>
          {(isOwner || isAdmin) && (
            <button
              type="button"
              onClick={() => void release()}
              disabled={busy !== null}
              className="mt-3 w-full rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50"
            >
              {busy === "release" ? "Releasing…" : "Release back to queue"}
            </button>
          )}
          {!isOwner && !isAdmin && (
            <p className="mt-2 text-[11px] text-magic-ink/45">
              Only the person working it can make changes.
            </p>
          )}
        </>
      )}

      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
    </div>
  );
}

/**
 * Once a lead is claimed-and-assigned, this panel shows the presales
 * Company → Client → Project tree the lead is filed under and offers a
 * one-click route into the client workspace. "Re-file…" re-opens the
 * dialog so a wrong link can be fixed without leaving the lead page.
 */
function PresalesFilingPanel({
  lead,
  onReassign,
}: {
  lead: LeadRow;
  onReassign: () => void;
}) {
  const filed = Boolean(lead.folder_id && lead.project_id);
  return (
    <div className="rounded-2xl border border-magic-border bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-magic-ink/70">
        Presales filing
      </h3>
      {filed ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-900">
          <div className="grid grid-cols-1 gap-1.5">
            <TreeRow
              label={lead.company_id ? "Company" : "Individual"}
              value={lead.company_name || lead.folder_name || "—"}
            />
            {lead.company_id && (
              <TreeRow label="Client" value={lead.folder_name || "—"} />
            )}
            <TreeRow label="Project" value={lead.project_name || "—"} />
          </div>
        </div>
      ) : (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          This lead hasn&apos;t been filed yet. Pick (or create) a presales
          Company / Individual → Client → Project tree to get going.
        </p>
      )}

      <p className="mt-3 text-xs text-magic-ink/60">
        Open the workspace to add quotations, BOQs, or POs against this
        project.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {lead.folder_id && (
          <a
            href={`/folder/${lead.folder_id}`}
            className="block w-full rounded-lg bg-magic-red px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90"
          >
            Open client workspace →
          </a>
        )}
        <button
          type="button"
          onClick={onReassign}
          className="block w-full rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft"
        >
          {filed ? "Re-file under a different tree" : "File this lead now"}
        </button>
      </div>
    </div>
  );
}

function TreeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-20 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-emerald-700/70">
        {label}
      </span>
      <span className="truncate text-sm font-semibold text-emerald-900">
        {value}
      </span>
    </div>
  );
}

function ReferenceItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-magic-border/60 bg-white px-2.5 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-magic-ink/45">
        {label}
      </div>
      <div className="truncate text-sm font-medium text-magic-ink/90">
        {value}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-magic-ink/50">
        {label}
      </dt>
      <dd className="text-sm text-magic-ink">{value}</dd>
    </div>
  );
}
