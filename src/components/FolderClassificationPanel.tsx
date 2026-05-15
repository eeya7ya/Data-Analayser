"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Admin → Folders: migration queue for client folders that still need
 * to be tied into the new CRM model. A folder appears here while either
 * its `kind` is unset or it is marked as a Company without a canonical
 * `companies` row linked. The moment it is marked Individual, or marked
 * Company AND linked to a company, it leaves the queue.
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

function needsMigration(f: FolderRow): boolean {
  if (f.kind === null) return true;
  if (f.kind === "company" && f.company_id === null) return true;
  return false;
}

export default function FolderClassificationPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
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

  const queue = useMemo(
    () => (data?.folders ?? []).filter(needsMigration),
    [data],
  );

  const visible = useMemo(() => {
    const lc = query.trim().toLowerCase();
    if (!lc) return queue;
    return queue.filter((f) => {
      const hay = [f.name, f.client_company, f.client_email, f.owner_username]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(lc);
    });
  }, [queue, query]);

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
          Migration queue. A folder appears here until it is either marked
          <em> Individual</em> or marked <em>Company</em> <strong>and</strong>{" "}
          linked to a canonical company. Once both are set, the row leaves
          this list automatically — already-classified folders are managed
          from the regular CRM views.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-magic-ink">
          {queue.length} folder{queue.length === 1 ? "" : "s"} awaiting
          migration
        </span>
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
          {queue.length === 0
            ? "All folders migrated. Nothing to do here."
            : "No folders match this search."}
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
