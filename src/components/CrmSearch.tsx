"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

/**
 * Unified search on /crm. Pulls companies (top-level business
 * entities) and client folders (individuals + company contacts) in
 * parallel on first mount, then filters client-side as the user
 * types. At current scale (~17 companies, ~70 folders) loading once
 * and filtering in memory is cheaper than round-tripping per keystroke.
 *
 * Results are split into two sections — Companies and Clients — and
 * each row links to the right CRM detail page. A company-kind client
 * routes through its parent company URL so the breadcrumb stays
 * consistent with the rest of the CRM drill-down.
 */

interface CompanyHit {
  id: number;
  name: string;
  website: string | null;
  industry: string | null;
  notes: string | null;
  client_count: number;
  quotation_count: number;
}

interface FolderHit {
  id: number;
  name: string;
  kind: "company" | "individual" | null;
  company_id: number | null;
  company_name?: string | null;
  client_email: string | null;
  client_phone: string | null;
  client_company: string | null;
  project_count: number;
  quotation_count: number;
}

export default function CrmSearch() {
  const [query, setQuery] = useState("");
  const [companies, setCompanies] = useState<CompanyHit[]>([]);
  const [folders, setFolders] = useState<FolderHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cRes, fRes] = await Promise.all([
          fetch("/api/companies", { cache: "no-store" }),
          fetch("/api/folders", { cache: "no-store" }),
        ]);
        if (!cRes.ok) throw new Error(`companies HTTP ${cRes.status}`);
        if (!fRes.ok) throw new Error(`folders HTTP ${fRes.status}`);
        const cData = (await cRes.json()) as { companies?: CompanyHit[] };
        const fData = (await fRes.json()) as { folders?: FolderHit[] };
        if (cancelled) return;
        setCompanies(Array.isArray(cData.companies) ? cData.companies : []);
        setFolders(Array.isArray(fData.folders) ? fData.folders : []);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const lc = query.trim().toLowerCase();
  const hasQuery = lc.length > 0;

  const companyHits = useMemo(() => {
    if (!hasQuery) return [];
    return companies.filter((c) => {
      const hay = [c.name, c.website, c.industry, c.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(lc);
    });
  }, [companies, lc, hasQuery]);

  const folderHits = useMemo(() => {
    if (!hasQuery) return [];
    return folders.filter((f) => {
      const hay = [
        f.name,
        f.client_email,
        f.client_phone,
        f.client_company,
        f.company_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(lc);
    });
  }, [folders, lc, hasQuery]);

  const totalHits = companyHits.length + folderHits.length;

  function folderHref(f: FolderHit): string {
    if (f.kind === "company" && f.company_id) {
      return `/crm/company/${f.company_id}/clients/${f.id}`;
    }
    if (f.kind === "individual") {
      return `/crm/individual/${f.id}`;
    }
    return `/crm/${f.kind ?? "individual"}/${f.id}`;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          type="search"
          placeholder="Search companies and clients by name, email, phone, website…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-lg border border-magic-border bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-magic-red"
        />
        {hasQuery && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-magic-ink/40 hover:text-magic-ink text-lg leading-none px-1"
          >
            ×
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {hasQuery && (
        <div className="rounded-2xl border border-magic-border bg-white p-4 space-y-4">
          {loading ? (
            <p className="text-sm text-magic-ink/60">Loading…</p>
          ) : totalHits === 0 ? (
            <p className="text-sm text-magic-ink/60">
              No matches for &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <>
              <div className="text-xs text-magic-ink/50">
                {totalHits} match{totalHits === 1 ? "" : "es"} for &ldquo;{query}
                &rdquo;
              </div>

              {companyHits.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-magic-ink/60">
                    Companies ({companyHits.length})
                  </h3>
                  <ul className="space-y-1.5">
                    {companyHits.map((c) => (
                      <li key={`c-${c.id}`}>
                        <Link
                          href={`/crm/company/${c.id}`}
                          className="block rounded-lg border border-magic-border px-3 py-2 hover:border-magic-red hover:bg-magic-soft/40 transition-colors"
                        >
                          <div className="font-semibold text-sm text-magic-ink">
                            {c.name}
                          </div>
                          <div className="text-xs text-magic-ink/60 mt-0.5">
                            {c.industry && <>{c.industry} · </>}
                            {c.website && <>{c.website} · </>}
                            {c.client_count} client
                            {c.client_count === 1 ? "" : "s"} ·{" "}
                            {c.quotation_count} quotation
                            {c.quotation_count === 1 ? "" : "s"}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {folderHits.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-magic-ink/60">
                    Clients ({folderHits.length})
                  </h3>
                  <ul className="space-y-1.5">
                    {folderHits.map((f) => (
                      <li key={`f-${f.id}`}>
                        <Link
                          href={folderHref(f)}
                          className="block rounded-lg border border-magic-border px-3 py-2 hover:border-magic-red hover:bg-magic-soft/40 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-magic-ink">
                              {f.name}
                            </span>
                            <span className="text-[10px] uppercase tracking-wide rounded-full bg-magic-soft px-2 py-0.5 text-magic-ink/60">
                              {f.kind === "company"
                                ? "Company contact"
                                : f.kind === "individual"
                                  ? "Individual"
                                  : "Unclassified"}
                            </span>
                          </div>
                          <div className="text-xs text-magic-ink/60 mt-0.5">
                            {f.company_name && <>@ {f.company_name} · </>}
                            {f.client_email && <>{f.client_email} · </>}
                            {f.client_phone && <>{f.client_phone} · </>}
                            {f.project_count} project
                            {f.project_count === 1 ? "" : "s"} ·{" "}
                            {f.quotation_count} quotation
                            {f.quotation_count === 1 ? "" : "s"}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
