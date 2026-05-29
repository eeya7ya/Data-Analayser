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
  assigned_to_id: number | null;
  assigned_to_username: string | null;
  assigned_to_name: string | null;
  assigned_at: string | null;
  company_id: number | null;
  folder_id: number | null;
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

interface CurrentUser {
  id: number;
  role: string;
  module_roles: Array<{ module: string; role: string }>;
}

const STATUS_PILL: Record<string, string> = {
  new: "bg-sky-100 text-sky-800 border-sky-200",
  in_progress: "bg-emerald-100 text-emerald-800 border-emerald-200",
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
      isPresales: has("crm", "presales") || has("crm", "presales_manager"),
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

  const assigned = lead.assigned_to_name || lead.assigned_to_username;
  const isOwner = me.id === lead.assigned_to_id;
  const isUnclaimed = lead.status === "new" || lead.assigned_to_id === null;
  const canClaim = flags.isPresales || flags.isAdmin;

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

      {/* Right rail — ownership + the work flow */}
      <div className="space-y-4">
        <OwnershipPanel
          lead={lead}
          assigned={assigned}
          isOwner={isOwner}
          isUnclaimed={isUnclaimed}
          canClaim={canClaim}
          isAdmin={flags.isAdmin}
          onChanged={reload}
        />

        {/* "Work on this lead" belongs to the person who claimed it. Admins
            keep it as a fill-in. */}
        {lead.status === "in_progress" &&
          (isOwner || flags.isAdmin) && (
            <WorkPanel
              leadId={lead.id}
              folderId={lead.folder_id}
              folderName={lead.folder_name}
              companyName={lead.company_name}
              onChanged={reload}
            />
          )}
      </div>
    </div>
  );
}

/**
 * The shared-queue ownership control. Replaces the old manager
 * "Distribute" panel: an unclaimed lead can be claimed by any presales
 * person; the owner (or an admin) can release it back to the queue.
 */
function OwnershipPanel({
  lead,
  assigned,
  isOwner,
  isUnclaimed,
  canClaim,
  isAdmin,
  onChanged,
}: {
  lead: LeadRow;
  assigned: string | null;
  isOwner: boolean;
  isUnclaimed: boolean;
  canClaim: boolean;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<"claim" | "release" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(action: "claim" | "release") {
    setBusy(action);
    setErr(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
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
    <div className="rounded-xl border border-magic-border bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-magic-ink/70">
        Ownership
      </h3>

      {isUnclaimed ? (
        <>
          <p className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800">
            This lead is unclaimed and sitting in the shared queue.
          </p>
          {canClaim ? (
            <button
              type="button"
              onClick={() => void act("claim")}
              disabled={busy !== null}
              className="mt-3 w-full rounded-lg bg-magic-red px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90 disabled:opacity-50"
            >
              {busy === "claim" ? "Claiming…" : "Claim this lead"}
            </button>
          ) : (
            <p className="mt-3 text-xs italic text-magic-ink/50">
              Waiting for a presales person to claim this lead.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
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
              onClick={() => void act("release")}
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

/**
 * Where the presales owner turns a claimed lead into real CRM work. The flow
 * mirrors the real process:
 *
 *   New client →  pick Company or Individual  →  create the client
 *   Existing   →  pick Company/Individual     →  select the client
 *
 * Either way the lead gets linked to a client folder (owned by the engineer,
 * so they keep access) and the panel then drops them into that client's
 * workspace, where they create a project and start a quotation or pricing.
 */
function WorkPanel({
  leadId,
  folderId,
  folderName,
  companyName,
  onChanged,
}: {
  leadId: number;
  folderId: number | null;
  folderName: string | null;
  companyName: string | null;
  onChanged: () => void;
}) {
  // Once linked, the panel is just the launch pad into the workspace.
  if (folderId) {
    return (
      <div className="rounded-xl border border-magic-border bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-magic-ink/70">
          Work on this lead
        </h3>
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Linked to client{" "}
          <span className="font-semibold">{folderName || `#${folderId}`}</span>
          {companyName && <> · {companyName}</>}.
        </p>
        <p className="mt-2 text-xs text-magic-ink/60">
          Next: open the workspace to create a project, then start a quotation
          or pricing for it.
        </p>
        <a
          href={`/folder/${folderId}`}
          className="mt-3 block w-full rounded-lg bg-magic-red px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90"
        >
          Open client workspace →
        </a>
        <LinkClientWizard
          leadId={leadId}
          onChanged={onChanged}
          relabel="Change linked client"
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-magic-border bg-white p-5 shadow-sm">
      <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-magic-ink/70">
        Work on this lead
      </h3>
      <p className="mb-3 text-xs text-magic-ink/60">
        Assign this lead to a company or an individual — create a brand-new
        client or add it to an existing one. Then open the workspace to create
        a project and start a quotation or pricing.
      </p>
      <LinkClientWizard leadId={leadId} onChanged={onChanged} startOpen />
    </div>
  );
}

/**
 * The company/individual + new/existing client picker. Collapsed by
 * default (a single "Change linked client" toggle) unless `startOpen`.
 */
function LinkClientWizard({
  leadId,
  onChanged,
  startOpen = false,
  relabel,
}: {
  leadId: number;
  onChanged: () => void;
  startOpen?: boolean;
  relabel?: string;
}) {
  const [open, setOpen] = useState(startOpen);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [kind, setKind] = useState<"individual" | "company">("individual");

  // shared
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // new-client fields
  const [clientName, setClientName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [newCompany, setNewCompany] = useState(""); // typed new company name

  // existing-client + company selection
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [companySel, setCompanySel] = useState<string>(""); // "" | id | "__new__"
  const [folders, setFolders] = useState<FolderOpt[]>([]);
  const [folderSel, setFolderSel] = useState<string>("");

  // Load companies whenever we need them (company kind, either mode).
  useEffect(() => {
    if (!open || kind !== "company") return;
    fetch("/api/companies", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { companies?: CompanyOpt[] }) => setCompanies(d.companies ?? []))
      .catch(() => setCompanies([]));
  }, [open, kind]);

  // Load the client list for the "existing" picker.
  useEffect(() => {
    if (!open || mode !== "existing") return;
    let url = "/api/folders";
    if (kind === "individual") url += "?kind=individual";
    else if (companySel && companySel !== "__new__")
      url += `?company_id=${companySel}`;
    else {
      setFolders([]);
      return;
    }
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { folders?: FolderOpt[] }) => setFolders(d.folders ?? []))
      .catch(() => setFolders([]));
    setFolderSel("");
  }, [open, mode, kind, companySel]);

  async function patchLead(folder_id: number, company_id: number | null) {
    const res = await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_id, company_id }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  }

  async function createCompanyIfNeeded(): Promise<number | null> {
    if (kind !== "company") return null;
    if (companySel === "__new__" || (mode === "new" && !companySel)) {
      const name = newCompany.trim();
      if (!name) throw new Error("Enter the company name.");
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json()) as {
        company?: { id: number };
        error?: string;
      };
      if (!res.ok || !data.company)
        throw new Error(data.error || "Could not create the company.");
      return data.company.id;
    }
    if (!companySel) throw new Error("Pick a company.");
    return Number(companySel);
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      if (mode === "existing") {
        if (!folderSel) throw new Error("Select a client.");
        const folder = folders.find((f) => String(f.id) === folderSel);
        await patchLead(Number(folderSel), folder?.company_id ?? null);
      } else {
        // NEW client → create the folder (and company first if needed).
        const name = clientName.trim();
        if (!name) throw new Error("Enter the client name.");
        const companyId = await createCompanyIfNeeded();
        const res = await fetch("/api/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            kind,
            company_id: companyId,
            client_email: email.trim() || null,
            client_phone: phone.trim() || null,
          }),
        });
        const data = (await res.json()) as {
          folder?: { id: number; company_id: number | null };
          error?: string;
        };
        if (!res.ok || !data.folder)
          throw new Error(data.error || "Could not create the client.");
        await patchLead(data.folder.id, data.folder.company_id ?? companyId);
      }
      setOpen(false);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 w-full rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft"
      >
        {relabel ?? "Link to a client"}
      </button>
    );
  }

  const fieldCls =
    "w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red";

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-magic-border/70 bg-magic-soft/30 p-3">
      {/* New vs existing */}
      <Segmented
        value={mode}
        onChange={(v) => setMode(v as "new" | "existing")}
        options={[
          { value: "new", label: "New client" },
          { value: "existing", label: "Existing" },
        ]}
      />

      {/* Company vs individual */}
      <Segmented
        value={kind}
        onChange={(v) => setKind(v as "individual" | "company")}
        options={[
          { value: "individual", label: "Individual" },
          { value: "company", label: "Company" },
        ]}
      />

      {mode === "new" ? (
        <div className="space-y-2">
          {kind === "company" && (
            <div className="space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-magic-ink/55">
                Company
              </label>
              <select
                value={companySel}
                onChange={(e) => setCompanySel(e.target.value)}
                className={fieldCls}
              >
                <option value="">➕ New company…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {(companySel === "" || companySel === "__new__") && (
                <input
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  placeholder="New company name"
                  className={fieldCls}
                />
              )}
            </div>
          )}
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-magic-ink/55">
            {kind === "company" ? "Client / contact name" : "Client name"}
          </label>
          <input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder={kind === "company" ? "e.g. Yahya Khaled" : "Full name"}
            className={fieldCls}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email (optional)"
              className={fieldCls}
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone (optional)"
              className={fieldCls}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {kind === "company" && (
            <select
              value={companySel}
              onChange={(e) => setCompanySel(e.target.value)}
              className={fieldCls}
            >
              <option value="">Pick a company…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <select
            value={folderSel}
            onChange={(e) => setFolderSel(e.target.value)}
            className={fieldCls}
            disabled={kind === "company" && !companySel}
          >
            <option value="">
              {kind === "company" && !companySel
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
        </div>
      )}

      {err && <p className="text-xs text-red-700">{err}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-magic-border bg-white px-3 py-2 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="flex-1 rounded-lg bg-magic-red px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90 disabled:opacity-50"
        >
          {busy
            ? "Working…"
            : mode === "new"
              ? "Create client & link"
              : "Link client"}
        </button>
      </div>
    </div>
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
