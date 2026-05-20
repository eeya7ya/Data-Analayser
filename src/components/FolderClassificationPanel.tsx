"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Admin → Folders: classify each client folder as Company or Individual,
 * and link Company folders to the canonical companies row. NULL-kind
 * folders sort to the top so the migration quarantine queue stays
 * visible. No folder is ever deleted from this UI; the worst-case
 * action is "un-classify" (kind = null), which sends the row back to
 * the top of the queue for re-review.
 */

interface FolderRow {
  id: number;
  name: string;
  kind: "company" | "individual" | null;
  company_id: number | null;
  company_name: string | null;
  owner_username: string | null;
  client_company: string | null;
  client_email: string | null;
  quotation_count: number;
  project_count: number;
}

interface CompanyOption {
  id: number;
  name: string;
}

interface Payload {
  folders: FolderRow[];
  companies: CompanyOption[];
}

type KindFilter = "unclassified" | "company" | "individual" | "all";

export default function FolderClassificationPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [filter, setFilter] = useState<KindFilter>("unclassified");
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/folder-kind", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as Payload;
      setData(payload);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function patch(
    folderId: number,
    kind: "company" | "individual" | null,
    companyId: number | null,
  ) {
    setBusyId(folderId);
    try {
      const res = await fetch("/api/admin/folder-kind", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          folder_id: folderId,
          kind,
          company_id: companyId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => {
    const c = { unclassified: 0, company: 0, individual: 0, all: 0 };
    for (const f of data?.folders ?? []) {
      c.all += 1;
      if (f.kind === null) c.unclassified += 1;
      else if (f.kind === "company") c.company += 1;
      else if (f.kind === "individual") c.individual += 1;
    }
    return c;
  }, [data]);

  const visible = useMemo(() => {
    const lc = query.trim().toLowerCase();
    return (data?.folders ?? []).filter((f) => {
      if (filter === "unclassified" && f.kind !== null) return false;
      if (filter === "company" && f.kind !== "company") return false;
      if (filter === "individual" && f.kind !== "individual") return false;
      if (lc) {
        const hay = [f.name, f.client_company, f.client_email, f.owner_username]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(lc)) return false;
      }
      return true;
    });
  }, [data, filter, query]);

  if (loading) {
    return <p className="text-sm text-magic-ink/60">Loading folders…</p>;
  }

  if (error && !data) {
    return (
      <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
        {error}
      </p>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-magic-border bg-white p-4">
        <p className="text-sm text-magic-ink/70">
          Each client folder needs a <strong>kind</strong> so the new module
          UI can tell Company clients from Individual ones. Folders created
          before V2.0 default to <em>unclassified</em> and surface here.
          Nothing is deleted by this screen — the worst-case action just
          sends a row back to the unclassified queue.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterPill
          active={filter === "unclassified"}
          onClick={() => setFilter("unclassified")}
          tone="warn"
        >
          Unclassified · {counts.unclassified}
        </FilterPill>
        <FilterPill
          active={filter === "company"}
          onClick={() => setFilter("company")}
        >
          Company · {counts.company}
        </FilterPill>
        <FilterPill
          active={filter === "individual"}
          onClick={() => setFilter("individual")}
        >
          Individual · {counts.individual}
        </FilterPill>
        <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
          All · {counts.all}
        </FilterPill>
        <input
          type="search"
          placeholder="Search folder, owner, email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ml-auto w-64 rounded-lg border border-magic-border bg-white px-3 py-1.5 text-sm"
        />
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-magic-ink/50 italic px-1">
          No folders match this filter.
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((f) => (
            <FolderRowItem
              key={f.id}
              folder={f}
              companies={data.companies}
              busy={busyId === f.id}
              onPatch={patch}
            />
          ))}
        </ul>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <ExportFooter totalFolders={data.folders.length} />
    </div>
  );
}

function ExportFooter({ totalFolders }: { totalFolders: number }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  async function download() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/backup", { method: "GET" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") || "";
      const match = cd.match(/filename="?([^";]+)"?/i);
      const filename = match
        ? match[1]
        : `magictech-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const mb = (blob.size / (1024 * 1024)).toFixed(2);
      setMsg({
        kind: "ok",
        text: `Downloaded ${filename} (${mb} MB). The ZIP contains JSON, CSV and SQL per table, plus a combined all.sql for one-shot restore.`,
      });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-magic-border bg-magic-soft/50 p-4">
      <h3 className="font-semibold text-magic-ink mb-1">
        Export everything for the new database
      </h3>
      <p className="text-sm text-magic-ink/70 mb-3">
        Downloads a single ZIP with every table in the public schema — folders,
        companies, contacts, users, quotations, projects, products, everything.
        Per-table files come in three re-importable formats:
      </p>
      <ul className="text-sm text-magic-ink/70 mb-3 ml-5 list-disc space-y-0.5">
        <li>
          <code className="text-xs bg-white px-1 rounded">data/&lt;table&gt;.json</code>{" "}
          — most portable, works in any new DB
        </li>
        <li>
          <code className="text-xs bg-white px-1 rounded">data/&lt;table&gt;.csv</code>{" "}
          — for spreadsheet / Cloudflare D1 bulk-import
        </li>
        <li>
          <code className="text-xs bg-white px-1 rounded">data/&lt;table&gt;.sql</code>{" "}
          and <code className="text-xs bg-white px-1 rounded">all.sql</code> —
          Postgres INSERT statements (foreign-key safe order)
        </li>
      </ul>
      <button
        onClick={download}
        disabled={busy}
        className="px-4 py-2 text-sm font-semibold rounded-lg bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
      >
        {busy
          ? "Preparing export…"
          : `Download full export ZIP (${totalFolders} folders + all tables)`}
      </button>
      {msg && (
        <p
          className={`mt-3 text-sm rounded-lg px-3 py-2 ${
            msg.kind === "ok"
              ? "text-green-700 bg-green-50 border border-green-200"
              : "text-red-700 bg-red-50 border border-red-200"
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}

function FolderRowItem({
  folder,
  companies,
  busy,
  onPatch,
}: {
  folder: FolderRow;
  companies: CompanyOption[];
  busy: boolean;
  onPatch: (
    folderId: number,
    kind: "company" | "individual" | null,
    companyId: number | null,
  ) => Promise<void>;
}) {
  const [companyId, setCompanyId] = useState<number | null>(folder.company_id);

  useEffect(() => {
    setCompanyId(folder.company_id);
  }, [folder.company_id]);

  const isCompany = folder.kind === "company";
  const isIndividual = folder.kind === "individual";

  return (
    <li className="rounded-xl border border-magic-border bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-magic-ink">{folder.name}</div>
          <div className="text-xs text-magic-ink/60">
            {folder.quotation_count} quotations · {folder.project_count}{" "}
            projects
            {folder.owner_username && <> · owner @{folder.owner_username}</>}
            {folder.client_email && <> · {folder.client_email}</>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <KindButton
            active={isCompany}
            onClick={() => void onPatch(folder.id, "company", companyId)}
            disabled={busy}
          >
            Company
          </KindButton>
          <KindButton
            active={isIndividual}
            onClick={() => void onPatch(folder.id, "individual", null)}
            disabled={busy}
            tone="alt"
          >
            Individual
          </KindButton>
          {folder.kind !== null && (
            <button
              onClick={() => void onPatch(folder.id, null, null)}
              disabled={busy}
              className="px-2 py-1 text-xs font-medium rounded border border-magic-border text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50 transition-colors"
              title="Send back to the unclassified queue"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {isCompany && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-magic-ink/70">Linked company:</span>
          <select
            value={companyId ?? ""}
            onChange={(e) =>
              setCompanyId(e.target.value === "" ? null : Number(e.target.value))
            }
            disabled={busy}
            className="rounded border border-magic-border bg-white px-2 py-1 text-sm"
          >
            <option value="">— none —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => void onPatch(folder.id, "company", companyId)}
            disabled={busy || companyId === folder.company_id}
            className="px-2.5 py-1 text-xs font-semibold rounded bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
          >
            Save link
          </button>
          {folder.company_name && (
            <span className="text-xs text-magic-ink/50">
              currently: {folder.company_name}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function FilterPill({
  active,
  onClick,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: "warn";
  children: React.ReactNode;
}) {
  const base = "px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors";
  const tones = active
    ? tone === "warn"
      ? "border-amber-300 bg-amber-50 text-amber-800"
      : "border-magic-red bg-magic-red/10 text-magic-red"
    : "border-magic-border bg-white text-magic-ink/70 hover:bg-magic-soft";
  return (
    <button onClick={onClick} className={`${base} ${tones}`}>
      {children}
    </button>
  );
}

function KindButton({
  active,
  onClick,
  disabled,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled: boolean;
  tone?: "alt";
  children: React.ReactNode;
}) {
  const base =
    "px-3 py-1 text-xs font-semibold rounded border transition-colors disabled:opacity-50";
  const tones = active
    ? tone === "alt"
      ? "border-indigo-400 bg-indigo-50 text-indigo-700"
      : "border-magic-red bg-magic-red text-white"
    : "border-magic-border bg-white text-magic-ink/70 hover:bg-magic-soft";
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${tones}`}>
      {children}
    </button>
  );
}
