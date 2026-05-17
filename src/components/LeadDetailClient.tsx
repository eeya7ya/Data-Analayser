"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LEAD_STATUS_LABEL, LEAD_STATUS_WAITING_ON } from "@/lib/leadConstants";

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
  presales_manager_id: number | null;
  presales_manager_username: string | null;
  assigned_to_id: number | null;
  assigned_to_username: string | null;
  assigned_to_name: string | null;
  assigned_at: string | null;
  company_id: number | null;
  company_name: string | null;
  folder_id: number | null;
  folder_name: string | null;
  contact_id: number | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  quotation_id: number | null;
  quotation_ref: string | null;
  quotation_project_name: string | null;
  quotation_sent_at: string | null;
  outcome: string | null;
  outcome_by_username: string | null;
  outcome_at: string | null;
  outcome_reason: string | null;
  boq_file_id: number | null;
  boq_filename: string | null;
  boq_uploaded_at: string | null;
  execution_assignee_id: number | null;
  execution_assignee_username: string | null;
  execution_assignee_name: string | null;
  sent_to_execution_at: string | null;
  project_id: number | null;
  project_name: string | null;
  completed_at: string | null;
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

interface UserRef {
  id: number;
  username: string;
  display_name: string;
}

interface CurrentUser {
  id: number;
  role: string;
  module_roles: Array<{ module: string; role: string }>;
}

const STATUS_PILL: Record<string, string> = {
  new: "bg-sky-100 text-sky-800 border-sky-200",
  assigned: "bg-indigo-100 text-indigo-800 border-indigo-200",
  in_progress: "bg-violet-100 text-violet-800 border-violet-200",
  quotation_sent: "bg-amber-100 text-amber-800 border-amber-200",
  won: "bg-emerald-100 text-emerald-800 border-emerald-200",
  lost: "bg-red-100 text-red-800 border-red-200",
  boq_in_progress: "bg-teal-100 text-teal-800 border-teal-200",
  sent_to_execution: "bg-cyan-100 text-cyan-800 border-cyan-200",
  completed: "bg-gray-200 text-gray-800 border-gray-300",
};

export default function LeadDetailClient({ leadId }: { leadId: number }) {
  const router = useRouter();
  const [lead, setLead] = useState<LeadRow | null>(null);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // bump to re-fetch after action

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
        // /api/auth/me returns { user: { id, role, ... }, module_roles: [...] }
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

  const reload = () => setTick((t) => t + 1);

  // Role flags derived from the auth/me response.
  const flags = useMemo(() => {
    if (!me) return null;
    const isAdmin = me.role === "admin";
    const has = (m: string, r: string) =>
      isAdmin || me.module_roles.some((g) => g.module === m && g.role === r);
    const isPresalesManager = has("crm", "presales_manager");
    const isPresales = has("crm", "presales") || isPresalesManager;
    const isSalesManager = has("crm", "sales_manager");
    const isSales = has("crm", "sales") || isSalesManager;
    return {
      isAdmin,
      isPresalesManager,
      isPresales,
      isSalesManager,
      isSales,
    };
  }, [me]);

  if (loading) {
    return (
      <div className="rounded-xl border border-magic-border bg-white p-6 text-center text-magic-ink/50">
        Loading lead…
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

  const isMine =
    lead.assigned_to_id === me.id || lead.created_by === me.id;
  const isExecutor = lead.execution_assignee_id === me.id;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="rounded-xl border border-magic-border bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-mono text-xs text-magic-ink/50">{lead.ref}</div>
              <h2 className="mt-1 text-xl font-bold text-magic-ink">{lead.title}</h2>
            </div>
            <span
              className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_PILL[lead.status] ?? ""}`}
            >
              {LEAD_STATUS_LABEL[lead.status as keyof typeof LEAD_STATUS_LABEL] ?? lead.status}
            </span>
          </div>

          <div className="mt-2 text-[11px] uppercase tracking-wide text-magic-ink/40">
            Waiting on:{" "}
            <span className="font-semibold text-magic-ink/70 normal-case">
              {LEAD_STATUS_WAITING_ON[lead.status as keyof typeof LEAD_STATUS_WAITING_ON] ??
                "—"}
            </span>
          </div>

          {lead.description && (
            <p className="mt-3 whitespace-pre-wrap text-sm text-magic-ink/80">
              {lead.description}
            </p>
          )}

          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Field label="Priority" value={lead.priority} />
            <Field label="Source" value={lead.source ?? "—"} />
            <Field
              label="Opened by"
              value={lead.created_by_name || lead.created_by_username || "—"}
            />
            <Field
              label="Requested response by"
              value={lead.requested_timeline_at ?? "—"}
            />
            <Field
              label="Assigned presales"
              value={lead.assigned_to_name || lead.assigned_to_username || "—"}
            />
            <Field
              label="Presales manager"
              value={lead.presales_manager_username ?? "—"}
            />
          </dl>

          {(lead.company_name || lead.folder_name || lead.contact_first_name) && (
            <div className="mt-4 rounded-lg border border-magic-border/60 bg-magic-soft/40 p-3 text-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-magic-ink/50">
                Linked CRM records
              </div>
              <div className="mt-1 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                {lead.company_name && (
                  <div>
                    <span className="text-magic-ink/40">Company:</span>{" "}
                    <span className="font-medium text-magic-ink">
                      {lead.company_name}
                    </span>
                  </div>
                )}
                {lead.folder_name && (
                  <div>
                    <span className="text-magic-ink/40">Client folder:</span>{" "}
                    <span className="font-medium text-magic-ink">
                      {lead.folder_name}
                    </span>
                  </div>
                )}
                {(lead.contact_first_name || lead.contact_last_name) && (
                  <div>
                    <span className="text-magic-ink/40">Contact:</span>{" "}
                    <span className="font-medium text-magic-ink">
                      {[lead.contact_first_name, lead.contact_last_name]
                        .filter(Boolean)
                        .join(" ")}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {lead.quotation_id && lead.quotation_ref && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-900/70">
                Quotation
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <div>
                  <div className="font-mono text-xs text-amber-900">
                    {lead.quotation_ref}
                  </div>
                  <div className="text-xs text-amber-900/70">
                    {lead.quotation_project_name}
                  </div>
                </div>
                <Link
                  href={`/quotation/${lead.quotation_ref}`}
                  className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                >
                  Open quotation
                </Link>
              </div>
              {lead.quotation_sent_at && (
                <p className="mt-1 text-[11px] text-amber-900/60">
                  Sent to sales: {new Date(lead.quotation_sent_at).toLocaleString()}
                </p>
              )}
            </div>
          )}

          {lead.outcome && (
            <div
              className={`mt-3 rounded-lg border p-3 text-sm ${
                lead.outcome === "won"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-red-200 bg-red-50 text-red-900"
              }`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
                Sales outcome
              </div>
              <div className="mt-1 text-sm font-bold">
                {lead.outcome.toUpperCase()}
              </div>
              {lead.outcome_reason && (
                <p className="mt-1 text-xs opacity-80">{lead.outcome_reason}</p>
              )}
              <p className="mt-1 text-[11px] opacity-60">
                {lead.outcome_by_username} ·{" "}
                {lead.outcome_at ? new Date(lead.outcome_at).toLocaleString() : ""}
              </p>
            </div>
          )}

          {lead.boq_file_id && lead.boq_filename && (
            <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-teal-900/70">
                BOQ
              </div>
              <div className="mt-1 text-sm font-medium text-teal-900">
                {lead.boq_filename}
              </div>
              {lead.boq_uploaded_at && (
                <p className="text-[11px] text-teal-900/60">
                  Uploaded {new Date(lead.boq_uploaded_at).toLocaleString()}
                </p>
              )}
              {lead.project_id && lead.project_name && (
                <p className="mt-1 text-[11px] text-teal-900/60">
                  Project: <span className="font-mono">{lead.project_name}</span>
                </p>
              )}
            </div>
          )}

          {lead.execution_assignee_id && (
            <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-cyan-900/70">
                Execution
              </div>
              <div className="mt-1 text-sm">
                Routed to{" "}
                <span className="font-semibold text-cyan-900">
                  {lead.execution_assignee_name ||
                    lead.execution_assignee_username}
                </span>
              </div>
              {lead.sent_to_execution_at && (
                <p className="text-[11px] text-cyan-900/60">
                  Sent {new Date(lead.sent_to_execution_at).toLocaleString()}
                </p>
              )}
              {lead.completed_at && (
                <p className="mt-1 text-[11px] font-semibold text-cyan-900/80">
                  Completed {new Date(lead.completed_at).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="rounded-xl border border-magic-border bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-magic-ink/70">
            Timeline
          </h3>
          <ol className="space-y-3">
            {events.length === 0 && (
              <li className="text-sm text-magic-ink/50">No activity yet.</li>
            )}
            {events.map((e) => (
              <li key={e.id} className="flex gap-3">
                <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-magic-red/60" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-magic-ink/50">
                      {e.verb}
                    </span>
                    <span className="text-[11px] text-magic-ink/40">
                      {new Date(e.created_at).toLocaleString()}
                    </span>
                  </div>
                  {e.message && (
                    <p className="text-sm text-magic-ink/80">{e.message}</p>
                  )}
                  {e.actor_username && (
                    <p className="text-[11px] text-magic-ink/40">
                      by {e.actor_name || e.actor_username}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* Right rail — context-aware actions */}
      <div className="space-y-4">
        <ActionsCard
          lead={lead}
          flags={flags}
          isMine={isMine}
          isExecutor={isExecutor}
          onChanged={reload}
          router={router}
        />
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

function ActionsCard({
  lead,
  flags,
  isMine,
  isExecutor,
  onChanged,
  router,
}: {
  lead: LeadRow;
  flags: {
    isAdmin: boolean;
    isPresalesManager: boolean;
    isPresales: boolean;
    isSalesManager: boolean;
    isSales: boolean;
  };
  isMine: boolean;
  isExecutor: boolean;
  onChanged: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const status = lead.status as keyof typeof LEAD_STATUS_LABEL;

  return (
    <div className="rounded-xl border border-magic-border bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-magic-ink/70">
        Actions
      </h3>
      <div className="space-y-3">
        {status === "new" && (flags.isPresalesManager || flags.isAdmin) && (
          <AssignPanel leadId={lead.id} onChanged={onChanged} />
        )}
        {status === "assigned" && (
          <>
            {(flags.isPresalesManager || flags.isAdmin) && (
              <AssignPanel leadId={lead.id} onChanged={onChanged} reassign />
            )}
            {(isMine || flags.isAdmin || flags.isPresalesManager) && (
              <SubmitQuotationPanel leadId={lead.id} onChanged={onChanged} />
            )}
          </>
        )}
        {status === "in_progress" &&
          (isMine || flags.isAdmin || flags.isPresalesManager) && (
            <SubmitQuotationPanel leadId={lead.id} onChanged={onChanged} />
          )}
        {status === "quotation_sent" && (flags.isSales || flags.isAdmin) && (
          <OutcomePanel leadId={lead.id} onChanged={onChanged} />
        )}
        {(status === "won" || status === "boq_in_progress") &&
          (isMine || flags.isPresalesManager || flags.isAdmin) && (
            <BoqPanel
              leadId={lead.id}
              folderId={lead.folder_id}
              currentBoqId={lead.boq_file_id}
              onChanged={onChanged}
              router={router}
            />
          )}
        {(status === "boq_in_progress" || status === "won") &&
          lead.boq_file_id &&
          (flags.isPresalesManager || flags.isAdmin) && (
            <SendToExecutionPanel leadId={lead.id} onChanged={onChanged} />
          )}
        {status === "sent_to_execution" &&
          (isExecutor || flags.isAdmin || flags.isPresalesManager) && (
            <CompletePanel leadId={lead.id} onChanged={onChanged} />
          )}
        {status === "lost" && (
          <p className="text-xs italic text-magic-ink/50">
            This lead is closed (lost). No further action available.
          </p>
        )}
        {status === "completed" && (
          <p className="text-xs italic text-magic-ink/50">
            This lead is complete. Audit-only.
          </p>
        )}
        {!flags.isAdmin &&
          !flags.isPresalesManager &&
          !flags.isSales &&
          !flags.isPresales &&
          !isExecutor && (
            <p className="text-xs italic text-magic-ink/50">
              You have read-only access to this lead.
            </p>
          )}
      </div>
    </div>
  );
}

function AssignPanel({
  leadId,
  onChanged,
  reassign = false,
}: {
  leadId: number;
  onChanged: () => void;
  reassign?: boolean;
}) {
  const [users, setUsers] = useState<UserRef[]>([]);
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/leads/users?role=presales", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { users?: UserRef[] }) => setUsers(d.users ?? []))
      .catch(() => setUsers([]));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!assigneeId) {
      setErr("Pick a presales user.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignee_id: Number(assigneeId),
          note: note.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-magic-border/60 pt-3">
      <h4 className="text-xs font-semibold text-magic-ink">
        {reassign ? "Re-assign presales engineer" : "Assign to presales engineer"}
      </h4>
      <select
        value={assigneeId}
        onChange={(e) => setAssigneeId(e.target.value)}
        className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
      >
        <option value="">Pick a presales engineer…</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.display_name || u.username}
          </option>
        ))}
      </select>
      <textarea
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note to include in the email"
        className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
      />
      {err && <p className="text-xs text-red-700">{err}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-magic-red px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90 disabled:opacity-50"
      >
        {busy ? "Sending…" : reassign ? "Re-assign & email" : "Assign & email"}
      </button>
    </form>
  );
}

interface QuotationOption {
  id: number;
  ref: string;
  project_name: string;
}

function SubmitQuotationPanel({
  leadId,
  onChanged,
}: {
  leadId: number;
  onChanged: () => void;
}) {
  const [quotations, setQuotations] = useState<QuotationOption[]>([]);
  const [quotationId, setQuotationId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/quotations`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { quotations?: QuotationOption[] }) =>
        setQuotations(d.quotations ?? []),
      )
      .catch(() => setQuotations([]));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!quotationId) {
      setErr("Select a quotation to send.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/submit-quotation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotation_id: Number(quotationId),
          subject: subject.trim() || undefined,
          body: body.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-magic-border/60 pt-3">
      <h4 className="text-xs font-semibold text-magic-ink">
        Submit quotation to sales
      </h4>
      <select
        value={quotationId}
        onChange={(e) => setQuotationId(e.target.value)}
        className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
      >
        <option value="">Pick the quotation to send…</option>
        {quotations.map((qq) => (
          <option key={qq.id} value={qq.id}>
            {qq.ref} — {qq.project_name}
          </option>
        ))}
      </select>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Email subject (optional)"
        className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
      />
      <textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Message to sales (optional — a default is used otherwise)"
        className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
      />
      {err && <p className="text-xs text-red-700">{err}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-magic-red px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90 disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send to sales"}
      </button>
    </form>
  );
}

function OutcomePanel({
  leadId,
  onChanged,
}: {
  leadId: number;
  onChanged: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"won" | "lost" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function decide(outcome: "won" | "lost") {
    setErr(null);
    setBusy(outcome);
    try {
      const res = await fetch(`/api/leads/${leadId}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, reason: reason.trim() || undefined }),
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
    <div className="space-y-2 border-t border-magic-border/60 pt-3">
      <h4 className="text-xs font-semibold text-magic-ink">Sales decision</h4>
      <textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Optional reason / notes for the decision"
        className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
      />
      {err && <p className="text-xs text-red-700">{err}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => decide("won")}
          disabled={!!busy}
          className="flex-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === "won" ? "Saving…" : "Mark WON"}
        </button>
        <button
          onClick={() => decide("lost")}
          disabled={!!busy}
          className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
        >
          {busy === "lost" ? "Saving…" : "Mark LOST"}
        </button>
      </div>
    </div>
  );
}

function BoqPanel({
  leadId,
  folderId,
  currentBoqId,
  onChanged,
  router,
}: {
  leadId: number;
  folderId: number | null;
  currentBoqId: number | null;
  onChanged: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const [fileId, setFileId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!fileId.trim()) {
      setErr("Enter the project_files id of the uploaded BOQ.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/boq`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boq_file_id: Number(fileId) }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-magic-border/60 pt-3">
      <h4 className="text-xs font-semibold text-magic-ink">
        {currentBoqId ? "Replace BOQ" : "Attach BOQ"}
      </h4>
      <p className="text-[11px] text-magic-ink/60">
        Upload the BOQ via the project's Files tab (kind = BOQ), then paste its
        file id below. We attach it to this lead and stamp the project.
      </p>
      {folderId && (
        <button
          type="button"
          onClick={() => router.push(`/folder/${folderId}`)}
          className="block w-full rounded-lg border border-magic-border bg-white px-2 py-1 text-[11px] font-semibold text-magic-ink hover:bg-magic-soft"
        >
          → Open the client folder to upload
        </button>
      )}
      <input
        value={fileId}
        onChange={(e) => setFileId(e.target.value)}
        type="number"
        placeholder="project_files id"
        className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
      />
      {err && <p className="text-xs text-red-700">{err}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-magic-red px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90 disabled:opacity-50"
      >
        {busy ? "Attaching…" : "Attach BOQ"}
      </button>
    </form>
  );
}

function SendToExecutionPanel({
  leadId,
  onChanged,
}: {
  leadId: number;
  onChanged: () => void;
}) {
  const [users, setUsers] = useState<UserRef[]>([]);
  const [assigneeId, setAssigneeId] = useState("");
  const [role, setRole] = useState("engineer");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/leads/users?role=projects", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { users?: UserRef[] }) => setUsers(d.users ?? []))
      .catch(() => setUsers([]));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!assigneeId) {
      setErr("Pick a project user.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/send-to-execution`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          execution_assignee_id: Number(assigneeId),
          role,
          subject: subject.trim() || undefined,
          body: body.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-magic-border/60 pt-3">
      <h4 className="text-xs font-semibold text-magic-ink">Send BOQ to execution</h4>
      <select
        value={assigneeId}
        onChange={(e) => setAssigneeId(e.target.value)}
        className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
      >
        <option value="">Pick a project user…</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.display_name || u.username}
          </option>
        ))}
      </select>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
      >
        <option value="engineer">Engineer</option>
        <option value="technical">Technical</option>
        <option value="manager">Project manager</option>
      </select>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Email subject (optional)"
        className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
      />
      <textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Message to the project user (optional)"
        className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
      />
      {err && <p className="text-xs text-red-700">{err}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-magic-red px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90 disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send to execution"}
      </button>
    </form>
  );
}

function CompletePanel({
  leadId,
  onChanged,
}: {
  leadId: number;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function complete() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/complete`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-magic-border/60 pt-3">
      <h4 className="text-xs font-semibold text-magic-ink">Execution</h4>
      {err && <p className="text-xs text-red-700">{err}</p>}
      <button
        onClick={complete}
        disabled={busy}
        className="w-full rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Mark complete"}
      </button>
    </div>
  );
}
