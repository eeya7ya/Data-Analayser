"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Select from "@/components/Select";

/**
 * The salesperson's received-quotations queue (rendered by /crm/received).
 * Lists quotations presales handed over via "Send to sales", and lets the
 * recipient FILE each one under a Company / Client → Project using the same
 * pick-or-create flow presales use to claim a lead (LeadAssignClient) — here
 * driven against a quotation via POST /api/quotations/file-to-sales.
 */

interface ReceivedItem {
  id: number;
  ref: string;
  project_name: string | null;
  client_name: string | null;
  /** 'active' for the original, 'draft' / 'review' for a branched version. */
  status?: string | null;
  /** The quotation ref a draft / revision was branched from. */
  parent_ref?: string | null;
  sent_to_sales_at: string | null;
  sent_by: string | null;
}

/**
 * Label for a version branched off an existing quotation number. Presales can
 * send the original AND any Draft (…D<n>) / Revision (…R<n>) of it, so the row
 * says which one this is instead of looking like a second, unrelated deal.
 */
function versionBadge(item: ReceivedItem): string | null {
  const kind =
    item.status === "draft"
      ? "Draft"
      : item.status === "review"
        ? "Revision"
        : null;
  if (!kind) return null;
  return item.parent_ref ? `${kind} of ${item.parent_ref}` : kind;
}

export default function ReceivedQuotationsClient() {
  const [items, setItems] = useState<ReceivedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filing, setFiling] = useState<ReceivedItem | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/quotations/received", { cache: "no-store" });
      const data = (await res.json()) as {
        quotations?: ReceivedItem[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setItems(data.quotations ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Send the quotation back to its presales author for changes. A note is
  // required (it's what the author sees), so we collect one before posting.
  const requestModification = useCallback(
    async (item: ReceivedItem) => {
      const note = window.prompt(
        `Request a modification on ${item.ref}. What needs to change? Presales will see this:`,
      );
      if (note === null) return;
      if (!note.trim()) {
        setError("Describe the change you need before sending it back.");
        return;
      }
      setBusyId(item.id);
      setError(null);
      try {
        const res = await fetch("/api/quotations/request-changes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, note: note.trim() }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setFlash(`Change request sent to presales for ${item.ref}.`);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  // Dismiss a received quotation the salesperson decides isn't a real deal.
  const junk = useCallback(
    async (item: ReceivedItem) => {
      const reason = window.prompt(
        `Junk ${item.ref}? It's removed from your queue for good — presales has ` +
          `to re-send it to bring it back. Add a reason (optional):`,
        "",
      );
      if (reason === null) return; // cancelled
      setBusyId(item.id);
      setError(null);
      try {
        const res = await fetch("/api/quotations/junk-received", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, reason: reason.trim() }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  if (loading) {
    return (
      <div className="rounded-2xl border border-magic-border bg-white p-8 text-center text-sm text-magic-ink/50">
        Loading received quotations…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-magic-border bg-white p-8 text-center text-sm text-magic-ink/50">
        Nothing here yet — quotations presales send to you will show up in this
        queue.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {flash && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {flash}
        </div>
      )}

      <Group
        title="To file"
        count={items.length}
        empty="No quotations waiting to be filed."
      >
        {items.map((it) => (
          <ReceivedRow
            key={it.id}
            item={it}
            busy={busyId === it.id}
            onFile={() => setFiling(it)}
            onRequestMod={() => void requestModification(it)}
            onJunk={() => void junk(it)}
          />
        ))}
      </Group>

      {filing && (
        <FileModal
          item={filing}
          onClose={() => setFiling(null)}
          onFiled={() => {
            setFiling(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function Group({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-magic-ink/60">
        {title}
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-magic-soft px-1.5 text-[10px] font-semibold text-magic-ink/60">
          {count}
        </span>
      </h2>
      {count === 0 ? (
        empty ? (
          <p className="rounded-xl border border-dashed border-magic-border bg-white/60 px-4 py-3 text-xs text-magic-ink/45">
            {empty}
          </p>
        ) : null
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

function ReceivedRow({
  item,
  busy,
  onFile,
  onRequestMod,
  onJunk,
}: {
  item: ReceivedItem;
  busy: boolean;
  onFile: () => void;
  onRequestMod: () => void;
  onJunk: () => void;
}) {
  const router = useRouter();
  const sentAt = item.sent_to_sales_at
    ? new Date(item.sent_to_sales_at).toLocaleDateString()
    : "";
  const version = versionBadge(item);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-magic-border bg-white px-4 py-3 shadow-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-xs font-semibold text-magic-red">
            {item.ref}
          </span>
          <span className="truncate text-sm font-semibold text-magic-ink">
            {item.project_name || "Untitled"}
          </span>
          {version && (
            <span
              title="A newer version of a quotation you already have — it walks the same cycle as the original"
              className="rounded-full border border-magic-accent/40 bg-magic-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-magic-accent"
            >
              {version}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-magic-ink/55">
          {item.client_name ? `${item.client_name} · ` : ""}
          {item.sent_by ? `sent by ${item.sent_by}` : "sent to sales"}
          {sentAt ? ` · ${sentAt}` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={() => router.push(`/quotation?id=${item.id}`)}
        className="rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft"
      >
        Open
      </button>
      <button
        type="button"
        onClick={onRequestMod}
        disabled={busy}
        title="Send it back to presales with a note describing the change"
        className="rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50"
      >
        Request modification
      </button>
      <button
        type="button"
        onClick={onJunk}
        disabled={busy}
        title="Remove this quotation from your queue for good (presales must re-send to bring it back)"
        className="rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/60 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-50"
      >
        Junk
      </button>
      <button
        type="button"
        onClick={onFile}
        disabled={busy}
        className="rounded-lg bg-magic-red px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-magic-red/90 disabled:opacity-50"
      >
        File / assign →
      </button>
    </div>
  );
}

// ── Filing modal: Company / Client → Project pick-or-create ────────────────

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

function FileModal({
  item,
  onClose,
  onFiled,
}: {
  item: ReceivedItem;
  onClose: () => void;
  onFiled: () => void;
}) {
  const [kind, setKind] = useState<"company" | "individual">("individual");

  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [companyMode, setCompanyMode] = useState<"existing" | "new">("existing");
  const [companySel, setCompanySel] = useState("");
  const [newCompanyName, setNewCompanyName] = useState("");

  const [folders, setFolders] = useState<FolderOpt[]>([]);
  const [folderMode, setFolderMode] = useState<"existing" | "new">("existing");
  const [folderSel, setFolderSel] = useState("");
  const [newFolderName, setNewFolderName] = useState(item.client_name || "");
  const [newFolderEmail, setNewFolderEmail] = useState("");
  const [newFolderPhone, setNewFolderPhone] = useState("");

  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [projectMode, setProjectMode] = useState<"existing" | "new">("existing");
  const [projectSel, setProjectSel] = useState("");
  const [newProjectName, setNewProjectName] = useState(item.project_name || "");
  const [newProjectDescription, setNewProjectDescription] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

  // Switching a parent resets the dependent selectors to "create new" so a
  // stale existing pick can't leak across trees.
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
        id: number;
        kind: "company" | "individual";
        company?: { id?: number; name?: string };
        folder: { id?: number; name?: string; email?: string; phone?: string };
        project: { id?: number; name?: string; description?: string };
      } = { id: item.id, kind, folder: {}, project: {} };

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
        if (!folderSel) throw new Error("Pick a client.");
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

      const res = await fetch("/api/quotations/file-to-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onFiled();
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-magic-ink">
              File {item.ref}
            </h2>
            <p className="mt-0.5 text-xs text-magic-ink/60">
              Pick or create the company, client and project this quotation
              belongs to.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-lg text-magic-ink/50 hover:text-magic-red"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mt-5">
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
              <Section
                title="Company"
                subtitle="Pick an existing one or create a new entry."
              >
                <Segmented
                  value={companyMode}
                  onChange={(v) => setCompanyMode(v as "existing" | "new")}
                  options={[
                    { value: "existing", label: "Select existing" },
                    { value: "new", label: "Create new" },
                  ]}
                />
                {companyMode === "existing" ? (
                  <Select
                    value={companySel}
                    onChange={(next) => setCompanySel(next)}
                    className={`${fieldCls} mt-2`}
                  >
                    <option value="">Select a company…</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
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
                <Select
                  value={folderSel}
                  onChange={(next) => setFolderSel(next)}
                  className={`${fieldCls} mt-2`}
                  disabled={
                    kind === "company" && companyMode === "existing" && !companySel
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
                </Select>
              ) : (
                <div className="mt-2 space-y-2">
                  <input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder={
                      kind === "company" ? "Contact / client name" : "Client full name"
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
              subtitle="The bucket this quotation (and its POs / BOQs) will live under."
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
                <Select
                  value={projectSel}
                  onChange={(next) => setProjectSel(next)}
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
                </Select>
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
              {busy ? "Filing…" : "File quotation"}
            </button>
          </div>
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
