"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageLoader from "@/components/PageLoader";

/**
 * Dedicated assignment-page form. Mirrors the in-place dialog used by
 * the lead detail re-file flow, but rendered as a full page reachable
 * only via /leads/[id]/assign. The list page sends presales here
 * explicitly when they press "Claim & file" — there is no auto-routing
 * elsewhere in the flow.
 *
 * On success: POST /api/leads/:id/assign-and-claim creates any missing
 * company / client / project records, files the lead, claims it, and
 * notifies the sales requester — atomically. The caller is bounced to
 * the new client workspace so they can immediately start a quotation.
 */

interface LeadRow {
  id: number;
  ref: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  assigned_to_id: number | null;
  assigned_to_username: string | null;
  company_name: string | null;
  folder_name: string | null;
  // Who raised the RFQ (the salesperson) and how to reach them.
  created_by_name: string | null;
  created_by_username: string | null;
  created_by_phone: string | null;
  created_by_email: string | null;
  // The client contact sales attached, if any.
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
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

export default function LeadAssignClient({ leadId }: { leadId: number }) {
  const router = useRouter();
  const [lead, setLead] = useState<LeadRow | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [kind, setKind] = useState<"company" | "individual">("individual");
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [companyMode, setCompanyMode] = useState<"existing" | "new">("existing");
  const [companySel, setCompanySel] = useState<string>("");
  const [newCompanyName, setNewCompanyName] = useState("");

  const [folders, setFolders] = useState<FolderOpt[]>([]);
  const [folderMode, setFolderMode] = useState<"existing" | "new">("existing");
  const [folderSel, setFolderSel] = useState<string>("");
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderEmail, setNewFolderEmail] = useState("");
  const [newFolderPhone, setNewFolderPhone] = useState("");

  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [projectMode, setProjectMode] = useState<"existing" | "new">("existing");
  const [projectSel, setProjectSel] = useState<string>("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Once the POST succeeds we render a success card (no auto-routing).
  // `folder_id` is the freshly-filed presales folder so the success card
  // can offer a "Open workspace" link the user picks deliberately.
  const [done, setDone] = useState<
    { folder_id: number | null; project_id: number | null } | null
  >(null);

  // Load the lead summary so the user can keep its title / description /
  // sales hint in view while picking the tree.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/leads/${leadId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { lead?: LeadRow; error?: string }) => {
        if (cancelled) return;
        if (d.error || !d.lead) {
          setLoadErr(d.error || "Lead not found.");
        } else {
          setLead(d.lead);
          if (!newProjectName) {
            setNewProjectName(d.lead.title || "Initial project");
          }
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadErr(e.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  useEffect(() => {
    if (kind !== "company") return;
    fetch("/api/companies", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { companies?: CompanyOpt[] }) => setCompanies(d.companies ?? []))
      .catch(() => setCompanies([]));
  }, [kind]);

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
      const payload: {
        kind: "company" | "individual";
        company?: { id?: number; name?: string };
        folder: { id?: number; name?: string; email?: string; phone?: string };
        project: { id?: number; name?: string; description?: string };
      } = { kind, folder: {}, project: {} };

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

      const res = await fetch(`/api/leads/${leadId}/assign-and-claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        error?: string;
        folder_id?: number;
        project_id?: number;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // NO auto-routing. We stay on this page and switch to a success
      // card so the user picks where to go next themselves. The previous
      // version did router.push("/folder/<id>") which is exactly the
      // auto-routing the user explicitly told us not to do.
      setDone({
        folder_id: data.folder_id ?? null,
        project_id: data.project_id ?? null,
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loadErr) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {loadErr}
      </div>
    );
  }
  if (!lead) {
    return (
      <div className="rounded-2xl border border-magic-border bg-white p-8 shadow-sm">
        <PageLoader label="Loading lead…" />
      </div>
    );
  }

  // Success card. We deliberately do NOT auto-navigate after filing —
  // the user picks where to go next.
  if (done) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
              ✓
            </div>
            <div>
              <h3 className="text-base font-bold text-emerald-900">
                {lead.ref} is filed and claimed.
              </h3>
              <p className="mt-1 text-sm text-emerald-900/80">
                The lead now lives under your presales tree. The sales
                requester has been notified that you picked it up.
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-magic-border bg-white p-5 shadow-sm">
          <p className="text-sm text-magic-ink/70">Where would you like to go?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {done.folder_id && (
              <button
                type="button"
                onClick={() => router.push(`/folder/${done.folder_id}`)}
                className="rounded-lg bg-magic-red px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90"
              >
                Open client workspace →
              </button>
            )}
            <button
              type="button"
              onClick={() => router.push("/leads")}
              className="rounded-lg border border-magic-border px-3 py-2 text-sm font-semibold text-magic-ink/70 hover:bg-magic-soft"
            >
              Back to leads list
            </button>
            <button
              type="button"
              onClick={() => router.push(`/leads/${leadId}`)}
              className="rounded-lg border border-magic-border px-3 py-2 text-sm font-semibold text-magic-ink/70 hover:bg-magic-soft"
            >
              Open this lead
            </button>
          </div>
        </div>
      </div>
    );
  }

  const fieldCls =
    "w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red";

  const alreadyAssigned =
    lead.assigned_to_id !== null && lead.status === "in_progress";

  return (
    <div className="space-y-5">
      {alreadyAssigned && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Heads up — this lead is already in progress with{" "}
          <span className="font-semibold">
            {lead.assigned_to_username || "another presales user"}
          </span>
          . Filing it again will move it to your tree (admin only).
        </div>
      )}

      <div className="rounded-2xl border border-magic-border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-xs font-semibold text-magic-red">
            {lead.ref}
          </span>
          <span className="text-magic-ink/40">·</span>
          <h2 className="text-lg font-bold text-magic-ink">{lead.title}</h2>
          <span className="ml-auto inline-flex items-center rounded-full border border-magic-border bg-magic-soft/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-magic-ink/70">
            {lead.priority}
          </span>
        </div>
        {lead.description && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-magic-ink/75">
            {lead.description}
          </p>
        )}
        {(lead.company_name || lead.folder_name) && (
          <p className="mt-2 text-[11px] text-magic-ink/45">
            Sales hint:{" "}
            {[lead.company_name, lead.folder_name].filter(Boolean).join(" · ")}
          </p>
        )}

        {/* Contact details sales sent with the RFQ. The salesperson (who to
            ask for clarification) and the client contact (who to serve) —
            phone + email each, shown only when present. */}
        {(() => {
          const salesName = lead.created_by_name || lead.created_by_username;
          const contactName = [lead.contact_first_name, lead.contact_last_name]
            .filter(Boolean)
            .join(" ");
          const hasSales =
            salesName || lead.created_by_phone || lead.created_by_email;
          const hasContact =
            contactName || lead.contact_phone || lead.contact_email;
          if (!hasSales && !hasContact) return null;
          return (
            <div className="mt-3 space-y-1.5 rounded-lg border border-magic-border/60 bg-magic-soft/30 px-3 py-2 text-xs">
              {hasSales && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className="font-semibold text-magic-ink/70">
                    Raised by{salesName ? ` ${salesName}` : ""}
                  </span>
                  {lead.created_by_phone && (
                    <a
                      href={`tel:${lead.created_by_phone}`}
                      className="text-magic-red hover:underline"
                    >
                      {lead.created_by_phone}
                    </a>
                  )}
                  {lead.created_by_email && (
                    <a
                      href={`mailto:${lead.created_by_email}`}
                      className="text-magic-red hover:underline"
                    >
                      {lead.created_by_email}
                    </a>
                  )}
                </div>
              )}
              {hasContact && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className="font-semibold text-magic-ink/70">
                    Client contact{contactName ? ` · ${contactName}` : ""}
                  </span>
                  {lead.contact_phone && (
                    <a
                      href={`tel:${lead.contact_phone}`}
                      className="text-magic-red hover:underline"
                    >
                      {lead.contact_phone}
                    </a>
                  )}
                  {lead.contact_email && (
                    <a
                      href={`mailto:${lead.contact_email}`}
                      className="text-magic-red hover:underline"
                    >
                      {lead.contact_email}
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      <div className="rounded-2xl border border-magic-border bg-white p-5 shadow-sm">
        <Segmented
          value={kind}
          onChange={(v) => setKind(v as "individual" | "company")}
          options={[
            { value: "individual", label: "Individual" },
            { value: "company", label: "Company" },
          ]}
        />

        <div className="mt-5 space-y-5">
          {kind === "company" && (
            <Section title="Company" subtitle="Pick an existing one or create a new entry.">
              <Segmented
                value={companyMode}
                onChange={(v) => setCompanyMode(v as "existing" | "new")}
                options={[
                  { value: "existing", label: "Select existing" },
                  { value: "new", label: "Create new" },
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
                { value: "existing", label: "Select existing" },
                { value: "new", label: "Create new" },
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

          <Section
            title="Project"
            subtitle="The bucket that quotations, POs, and BOQs will live under."
          >
            <Segmented
              value={projectMode}
              onChange={(v) => setProjectMode(v as "existing" | "new")}
              options={[
                { value: "existing", label: "Select existing" },
                { value: "new", label: "Create new" },
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

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => router.push("/leads")}
            disabled={busy}
            className="rounded-lg border border-magic-border bg-white px-3 py-2 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50"
          >
            Back to list
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
