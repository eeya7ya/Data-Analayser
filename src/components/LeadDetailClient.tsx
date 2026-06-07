"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
 *      claim with no choices. Now it opens <ClaimAssignmentDialog>,
 *      which forces the presales author to pick (or create) the
 *      Company-or-Individual → Client → Project tree the lead will be
 *      filed under. The whole assignment lands in one round-trip via
 *      POST /api/leads/:id/assign-and-claim so there are no half-states.
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

interface CompanyOpt {
  id: number;
  name: string;
}
interface FolderOpt {
  id: number;
  name: string;
  kind: "company" | "individual" | null;
  company_id: number | null;
  company_name?: string | null;
}
interface ProjectOpt {
  id: number;
  name: string;
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
  const [lead, setLead] = useState<LeadRow | null>(null);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [claimOpen, setClaimOpen] = useState(false);

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
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        {error ?? "Lead not available."}
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
          onClaimRequested={() => setClaimOpen(true)}
        />

        {lead.status === "in_progress" && (isOwner || flags.isAdmin) && (
          <PresalesFilingPanel
            lead={lead}
            onReassign={() => setClaimOpen(true)}
          />
        )}
      </div>

      {claimOpen && (
        <ClaimAssignmentDialog
          lead={lead}
          presetKind={lead.folder_name ? undefined : undefined}
          onClose={() => setClaimOpen(false)}
          onDone={() => {
            setClaimOpen(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * Ownership card. The "Claim this lead" button no longer talks to the API
 * directly — it opens the ClaimAssignmentDialog so the presales author
 * has to pick a tree before the claim is recorded. Release still goes
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

/**
 * Forced claim assignment dialog. Replaces the old "claim, then maybe
 * link a client" two-step flow. Presales picks the kind, the company
 * (when applicable), the client folder, and the project — all in one
 * place, with the lead context shown at the top so they don't have to
 * scroll back and forth.
 *
 * The whole assignment is submitted via POST
 * /api/leads/:id/assign-and-claim which creates any missing records,
 * stamps the lead, and notifies the salesperson — atomically, so the
 * lead is never half-assigned.
 */
function ClaimAssignmentDialog({
  lead,
  onClose,
  onDone,
}: {
  lead: LeadRow;
  presetKind?: "company" | "individual";
  onClose: () => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<"company" | "individual">("individual");

  // Company branch
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [companyMode, setCompanyMode] = useState<"existing" | "new">("new");
  const [companySel, setCompanySel] = useState<string>("");
  const [newCompanyName, setNewCompanyName] = useState("");

  // Folder (client) branch
  const [folders, setFolders] = useState<FolderOpt[]>([]);
  const [folderMode, setFolderMode] = useState<"existing" | "new">("new");
  const [folderSel, setFolderSel] = useState<string>("");
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderEmail, setNewFolderEmail] = useState("");
  const [newFolderPhone, setNewFolderPhone] = useState("");

  // Project branch
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [projectMode, setProjectMode] = useState<"existing" | "new">("new");
  const [projectSel, setProjectSel] = useState<string>("");
  const [newProjectName, setNewProjectName] = useState(
    lead.title || "Initial project",
  );
  const [newProjectDescription, setNewProjectDescription] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load companies once for the company branch.
  useEffect(() => {
    if (kind !== "company") return;
    fetch("/api/companies", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { companies?: CompanyOpt[] }) => setCompanies(d.companies ?? []))
      .catch(() => setCompanies([]));
  }, [kind]);

  // Load folders matching the current branch.
  useEffect(() => {
    let url = "/api/folders";
    if (kind === "individual") url += "?kind=individual";
    else if (companyMode === "existing" && companySel)
      url += `?company_id=${companySel}`;
    else {
      setFolders([]);
      return;
    }
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { folders?: FolderOpt[] }) => setFolders(d.folders ?? []))
      .catch(() => setFolders([]));
  }, [kind, companyMode, companySel]);

  // Load projects under the selected existing folder.
  useEffect(() => {
    if (folderMode !== "existing" || !folderSel) {
      setProjects([]);
      return;
    }
    fetch(`/api/projects?folder_id=${folderSel}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { projects?: ProjectOpt[] }) => setProjects(d.projects ?? []))
      .catch(() => setProjects([]));
  }, [folderMode, folderSel]);

  // Switching kind or company mode invalidates downstream selections.
  useEffect(() => {
    setFolderMode("new");
    setFolderSel("");
    setProjectMode("new");
    setProjectSel("");
  }, [kind, companyMode, companySel]);
  useEffect(() => {
    setProjectMode("new");
    setProjectSel("");
  }, [folderMode, folderSel]);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      // Build payload per branch.
      const payload: {
        kind: "company" | "individual";
        company?: { id?: number; name?: string };
        folder: { id?: number; name?: string; email?: string; phone?: string };
        project: { id?: number; name?: string; description?: string };
      } = {
        kind,
        folder: {},
        project: {},
      };

      if (kind === "company") {
        if (companyMode === "existing") {
          if (!companySel) throw new Error("Pick a company.");
          payload.company = { id: Number(companySel) };
        } else {
          const name = newCompanyName.trim();
          if (!name) throw new Error("Enter a name for the new company.");
          payload.company = { name };
        }
      }

      if (folderMode === "existing") {
        if (!folderSel) throw new Error("Pick a client folder.");
        payload.folder = { id: Number(folderSel) };
      } else {
        const name = newFolderName.trim();
        if (!name) throw new Error("Enter a name for the new client.");
        payload.folder = {
          name,
          email: newFolderEmail.trim() || undefined,
          phone: newFolderPhone.trim() || undefined,
        };
      }

      if (projectMode === "existing") {
        if (!projectSel) throw new Error("Pick a project.");
        payload.project = { id: Number(projectSel) };
      } else {
        const name = newProjectName.trim();
        if (!name) throw new Error("Enter a name for the new project.");
        payload.project = {
          name,
          description: newProjectDescription.trim() || undefined,
        };
      }

      const res = await fetch(`/api/leads/${lead.id}/assign-and-claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const fieldCls =
    "w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-magic-ink/40 px-4 py-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-magic-ink">
              File this lead under a presales tree
            </h3>
            <p className="mt-1 text-xs text-magic-ink/60">
              Pick the Company / Individual → Client → Project the work
              belongs under. The presales filing is separate from any
              loose hints sales attached.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-magic-ink/50 hover:text-magic-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Lead summary — visible while filing so the presales author
            doesn't have to scroll back. */}
        <div className="mb-5 rounded-xl border border-magic-border bg-magic-soft/40 px-4 py-3 text-xs text-magic-ink/80">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono font-semibold text-magic-red">
              {lead.ref}
            </span>
            <span className="text-magic-ink/40">·</span>
            <span className="font-semibold text-magic-ink">{lead.title}</span>
            <span className="ml-auto inline-flex items-center rounded-full border border-magic-border bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-magic-ink/60">
              {lead.priority}
            </span>
          </div>
          {lead.description && (
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-magic-ink/70">
              {lead.description}
            </p>
          )}
          {(lead.company_name || lead.folder_name) && (
            <p className="mt-2 text-[11px] text-magic-ink/45">
              Sales hint:{" "}
              {[lead.company_name, lead.folder_name].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>

        {/* Kind toggle */}
        <Segmented
          value={kind}
          onChange={(v) => setKind(v as "individual" | "company")}
          options={[
            { value: "individual", label: "Individual" },
            { value: "company", label: "Company" },
          ]}
        />

        <div className="mt-4 space-y-5">
          {/* Company step — only for company branch */}
          {kind === "company" && (
            <Section title="Company" subtitle="Pick an existing one or create a new entry.">
              <Segmented
                value={companyMode}
                onChange={(v) => setCompanyMode(v as "existing" | "new")}
                options={[
                  { value: "new", label: "New company" },
                  { value: "existing", label: "Existing" },
                ]}
              />
              {companyMode === "existing" ? (
                <select
                  value={companySel}
                  onChange={(e) => setCompanySel(e.target.value)}
                  className={`${fieldCls} mt-2`}
                >
                  <option value="">Select a company…</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  placeholder="New company name"
                  className={`${fieldCls} mt-2`}
                />
              )}
            </Section>
          )}

          {/* Client folder step */}
          <Section
            title={kind === "company" ? "Client / contact" : "Client"}
            subtitle={
              kind === "company"
                ? "The person or team at the company you'll be working with."
                : "The individual this work is for."
            }
          >
            <Segmented
              value={folderMode}
              onChange={(v) => setFolderMode(v as "existing" | "new")}
              options={[
                { value: "new", label: "New client" },
                { value: "existing", label: "Existing" },
              ]}
            />
            {folderMode === "existing" ? (
              <select
                value={folderSel}
                onChange={(e) => setFolderSel(e.target.value)}
                className={`${fieldCls} mt-2`}
                disabled={
                  kind === "company" &&
                  companyMode === "existing" &&
                  !companySel
                }
              >
                <option value="">
                  {kind === "company" &&
                  companyMode === "existing" &&
                  !companySel
                    ? "Pick a company first…"
                    : "Select the client…"}
                </option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {f.company_name ? ` · ${f.company_name}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mt-2 space-y-2">
                <input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder={
                    kind === "company"
                      ? "Contact / client name"
                      : "Client full name"
                  }
                  className={fieldCls}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={newFolderEmail}
                    onChange={(e) => setNewFolderEmail(e.target.value)}
                    placeholder="Email (optional)"
                    className={fieldCls}
                  />
                  <input
                    value={newFolderPhone}
                    onChange={(e) => setNewFolderPhone(e.target.value)}
                    placeholder="Phone (optional)"
                    className={fieldCls}
                  />
                </div>
              </div>
            )}
          </Section>

          {/* Project step */}
          <Section
            title="Project"
            subtitle="The bucket that quotations, POs, and BOQs will live under."
          >
            <Segmented
              value={projectMode}
              onChange={(v) => setProjectMode(v as "existing" | "new")}
              options={[
                { value: "new", label: "New project" },
                { value: "existing", label: "Existing" },
              ]}
            />
            {projectMode === "existing" ? (
              <select
                value={projectSel}
                onChange={(e) => setProjectSel(e.target.value)}
                className={`${fieldCls} mt-2`}
                disabled={folderMode !== "existing" || !folderSel}
              >
                <option value="">
                  {folderMode !== "existing" || !folderSel
                    ? "Pick an existing client first…"
                    : "Select the project…"}
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mt-2 space-y-2">
                <input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Project name"
                  className={fieldCls}
                />
                <textarea
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                  placeholder="Short description (optional)"
                  rows={2}
                  className={fieldCls}
                />
              </div>
            )}
          </Section>
        </div>

        {err && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {err}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-magic-border bg-white px-3 py-2 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-lg bg-magic-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90 disabled:opacity-50"
          >
            {busy ? "Filing…" : "Claim & file lead"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h4 className="text-xs font-bold uppercase tracking-wide text-magic-ink/70">
        {title}
      </h4>
      {subtitle && (
        <p className="mt-0.5 text-[11px] text-magic-ink/55">{subtitle}</p>
      )}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="inline-flex w-full items-center gap-0.5 rounded-lg border border-magic-border bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
            value === o.value
              ? "bg-magic-red text-white shadow-sm"
              : "text-magic-ink/60 hover:text-magic-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
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
