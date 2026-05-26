"use client";

import { useEffect, useMemo, useState } from "react";
import { LEAD_STATUS_LABEL } from "@/lib/leadConstants";

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
  presales_manager_username: string | null;
  assigned_to_id: number | null;
  assigned_to_username: string | null;
  assigned_to_name: string | null;
  assigned_at: string | null;
  company_name: string | null;
  folder_name: string | null;
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
  distributed: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export default function LeadDetailClient({ leadId }: { leadId: number }) {
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

  const flags = useMemo(() => {
    if (!me) return null;
    const isAdmin = me.role === "admin";
    const has = (m: string, r: string) =>
      isAdmin || me.module_roles.some((g) => g.module === m && g.role === r);
    return {
      isAdmin,
      isPresalesManager: has("crm", "presales_manager"),
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

  const canDistribute = flags.isPresalesManager || flags.isAdmin;
  const assigned = lead.assigned_to_name || lead.assigned_to_username;

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
              className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_PILL[lead.status] ?? "border-slate-200 bg-slate-100 text-slate-700"}`}
            >
              {LEAD_STATUS_LABEL[lead.status as keyof typeof LEAD_STATUS_LABEL] ?? lead.status}
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
              label="Distributed to"
              value={assigned || "—"}
            />
            <Field
              label="Distributed by"
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

      {/* Right rail — distribution is the lead's only action */}
      <div className="space-y-4">
        <div className="rounded-xl border border-magic-border bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-magic-ink/70">
            Distribution
          </h3>
          {lead.status === "distributed" && (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              Distributed to{" "}
              <span className="font-semibold">{assigned || "a presales member"}</span>
              {lead.assigned_at && (
                <> · {new Date(lead.assigned_at).toLocaleDateString()}</>
              )}
              . This lead&apos;s job is complete.
            </p>
          )}
          {canDistribute ? (
            <DistributePanel
              leadId={lead.id}
              onChanged={reload}
              reassign={lead.status === "distributed"}
            />
          ) : (
            lead.status === "new" && (
              <p className="text-xs italic text-magic-ink/50">
                Waiting for a presales manager to distribute this lead.
              </p>
            )
          )}
        </div>
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

/**
 * Presales manager distributes the lead to a presales member. Posting to
 * the assign route flips the lead to `distributed` — its terminal state.
 */
function DistributePanel({
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
      setErr("Pick a presales member.");
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
    <form onSubmit={submit} className="mt-2 space-y-2">
      <h4 className="text-xs font-semibold text-magic-ink">
        {reassign ? "Re-distribute to another member" : "Distribute to a presales member"}
      </h4>
      <select
        value={assigneeId}
        onChange={(e) => setAssigneeId(e.target.value)}
        className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
      >
        <option value="">Pick a presales member…</option>
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
        placeholder="Optional note to include in the message"
        className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
      />
      {err && <p className="text-xs text-red-700">{err}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-magic-red px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90 disabled:opacity-50"
      >
        {busy ? "Sending…" : reassign ? "Re-distribute & notify" : "Distribute & notify"}
      </button>
    </form>
  );
}
