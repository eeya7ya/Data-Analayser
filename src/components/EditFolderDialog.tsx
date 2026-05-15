"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export interface EditableFolder {
  id: number;
  name: string;
  client_email: string | null;
  client_phone: string | null;
  client_company: string | null;
  kind?: "company" | "individual" | null;
  company_id?: number | null;
}

interface CompanyOption {
  id: number;
  name: string;
}

type KindChoice = "individual" | "company";

export function EditFolderDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: EditableFolder;
  onClose: () => void;
  onSaved: (f: EditableFolder) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.client_email ?? "");
  const [phone, setPhone] = useState(initial.client_phone ?? "");
  const [company, setCompany] = useState(initial.client_company ?? "");
  // Reassign state. Default to whatever the folder is today; if the
  // folder is unclassified (kind = null) we present it as Individual
  // so the user always has a concrete choice and can switch over.
  const initialKind: KindChoice = initial.kind === "company" ? "company" : "individual";
  const [kind, setKind] = useState<KindChoice>(initialKind);
  const [companyId, setCompanyId] = useState<number | null>(
    initial.company_id ?? null,
  );
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pull the companies list lazily once the user actually wants to
  // assign one — keeps the dialog snappy for plain renames.
  useEffect(() => {
    if (kind !== "company" || companies.length > 0 || companiesLoading) return;
    let cancelled = false;
    setCompaniesLoading(true);
    fetch("/api/companies", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { companies?: CompanyOption[] }) => {
        if (cancelled) return;
        const list = Array.isArray(data.companies) ? data.companies : [];
        setCompanies(list);
        if (companyId === null && list.length > 0) {
          setCompanyId(list[0].id);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load companies");
        }
      })
      .finally(() => {
        if (!cancelled) setCompaniesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, companies.length, companiesLoading, companyId]);

  const kindChanged = kind !== initialKind;
  const companyChanged =
    kind === "company" && companyId !== (initial.company_id ?? null);
  const reassigning = kindChanged || companyChanged;

  async function submit() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (kind === "company" && companyId === null) {
      setError("Pick a company, or switch type to Individual.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        client_email: email.trim() || null,
        client_phone: phone.trim() || null,
        client_company: company.trim() || null,
      };
      if (reassigning) {
        body.kind = kind;
        body.company_id = kind === "company" ? companyId : null;
      }
      const res = await fetch(`/api/folders?id=${initial.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onSaved({
        id: initial.id,
        name: data.folder.name,
        client_email: data.folder.client_email,
        client_phone: data.folder.client_phone,
        client_company: data.folder.client_company,
        kind: data.folder.kind,
        company_id: data.folder.company_id,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-magic-ink/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-magic-ink">Edit client</h3>
          <button
            onClick={onClose}
            className="text-magic-ink/50 hover:text-magic-ink"
          >
            ×
          </button>
        </div>
        <input
          type="text"
          placeholder="Name (required)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          autoFocus
          className="w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          className="w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
        />
        <input
          type="tel"
          placeholder="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={busy}
          className="w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
        />
        <input
          type="text"
          placeholder="Company (free text)"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          disabled={busy}
          className="w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
        />

        <div className="pt-2 border-t border-magic-border/60 space-y-2">
          <p className="text-xs font-semibold text-magic-ink/70">Type</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setKind("individual")}
              disabled={busy}
              className={`flex-1 rounded border px-3 py-1.5 text-xs font-semibold transition-colors ${
                kind === "individual"
                  ? "border-magic-red bg-magic-red/5 text-magic-red"
                  : "border-magic-border text-magic-ink/70 hover:bg-magic-soft"
              }`}
            >
              Individual
            </button>
            <button
              type="button"
              onClick={() => setKind("company")}
              disabled={busy}
              className={`flex-1 rounded border px-3 py-1.5 text-xs font-semibold transition-colors ${
                kind === "company"
                  ? "border-magic-red bg-magic-red/5 text-magic-red"
                  : "border-magic-border text-magic-ink/70 hover:bg-magic-soft"
              }`}
            >
              Company
            </button>
          </div>
          {kind === "company" && (
            <select
              value={companyId ?? ""}
              onChange={(e) =>
                setCompanyId(e.target.value ? Number(e.target.value) : null)
              }
              disabled={busy || companiesLoading}
              className="w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
            >
              <option value="" disabled>
                {companiesLoading ? "Loading…" : "Pick a company"}
              </option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {reassigning && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              {kind === "individual"
                ? "Switching to Individual will detach this client from any company."
                : "Switching to Company will move this client (and their projects) under the chosen company."}
            </p>
          )}
        </div>

        {error && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !name.trim()}
            className="rounded bg-magic-red text-white px-3 py-1.5 text-xs font-semibold hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function EditFolderButton({ folder }: { folder: EditableFolder }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft transition-colors"
      >
        Edit
      </button>
      {open && (
        <EditFolderDialog
          initial={folder}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
