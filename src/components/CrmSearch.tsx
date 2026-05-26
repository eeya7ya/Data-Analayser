"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * Unified search on /crm. Hits /api/crm/search which scans companies,
 * client folders, projects, quotations (by REF), and purchase orders
 * (by PO number) in one round-trip. Debounced 250ms so each keystroke
 * doesn't fire its own request.
 *
 * Result rows carry enough context to build the right CRM drill-down
 * URL: a quotation under a company contact links through
 * /crm/company/<companyId>/clients/<folderId>/<projectId>/quotations/<qId>,
 * while individual-folder quotations skip the company layer.
 */

interface CompanyHit {
  id: number;
  name: string;
  website: string | null;
  industry: string | null;
}

interface FolderHit {
  id: number;
  name: string;
  kind: "company" | "individual" | null;
  company_id: number | null;
  company_name: string | null;
  client_email: string | null;
  client_phone: string | null;
}

interface ProjectHit {
  id: number;
  name: string;
  description: string | null;
  folder_id: number;
  folder_name: string | null;
  folder_kind: "company" | "individual" | null;
  company_id: number | null;
  company_name: string | null;
}

interface QuotationHit {
  id: number;
  ref: string;
  client_name: string | null;
  project_name: string | null;
  status: string | null;
  folder_id: number | null;
  project_id: number | null;
  folder_kind: "company" | "individual" | null;
  company_id: number | null;
  company_name: string | null;
}

interface PoHit {
  id: number;
  po_number: string;
  supplier: string | null;
  client_name: string | null;
  project_name: string | null;
  status: string | null;
  folder_id: number | null;
  project_id: number | null;
  folder_kind: "company" | "individual" | null;
  company_id: number | null;
  company_name: string | null;
}

interface SearchResults {
  companies: CompanyHit[];
  folders: FolderHit[];
  projects: ProjectHit[];
  quotations: QuotationHit[];
  purchaseOrders: PoHit[];
}

const EMPTY: SearchResults = {
  companies: [],
  folders: [],
  projects: [],
  quotations: [],
  purchaseOrders: [],
};

function folderBase(
  kind: "company" | "individual" | null,
  companyId: number | null,
  folderId: number,
): string {
  if (kind === "company" && companyId) {
    return `/crm/company/${companyId}/clients/${folderId}`;
  }
  if (kind === "individual") {
    return `/crm/individual/${folderId}`;
  }
  // Unclassified / orphaned folder (no kind, or a company folder missing its
  // company link). These have no place in the company/individual route trees,
  // so we send them to the universal per-folder drill-down at /folder/[id].
  return `/folder/${folderId}`;
}

function quotationHref(qq: QuotationHit): string {
  if (qq.folder_id == null) return "/crm";
  const base = folderBase(qq.folder_kind, qq.company_id, qq.folder_id);
  // The deep /quotations/[qId] path only exists under the company/individual
  // route trees; unclassified folders resolve to /folder/[id], which has no
  // such sub-route, so land on the folder page instead.
  if (qq.project_id && qq.folder_kind) {
    return `${base}/${qq.project_id}/quotations/${qq.id}`;
  }
  // Project couldn't be resolved (legacy row + no default project yet).
  // Land on the client page; the user can drill the last step manually.
  return base;
}

function poHref(po: PoHit): string {
  if (po.folder_id == null) return "/crm";
  const base = folderBase(po.folder_kind, po.company_id, po.folder_id);
  if (po.project_id && po.folder_kind) return `${base}/${po.project_id}/pos`;
  return base;
}

export default function CrmSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(EMPTY);
      setError(null);
      setLoading(false);
      abortRef.current?.abort();
      return;
    }

    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    setLoading(true);

    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/crm/search?q=${encodeURIComponent(trimmed)}`,
          { cache: "no-store", signal: ctrl.signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Partial<SearchResults>;
        if (ctrl.signal.aborted) return;
        setResults({
          companies: data.companies ?? [],
          folders: data.folders ?? [],
          projects: data.projects ?? [],
          quotations: data.quotations ?? [],
          purchaseOrders: data.purchaseOrders ?? [],
        });
        setError(null);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(handle);
      ctrl.abort();
    };
  }, [query]);

  const hasQuery = query.trim().length > 0;
  const total =
    results.companies.length +
    results.folders.length +
    results.projects.length +
    results.quotations.length +
    results.purchaseOrders.length;

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          type="search"
          placeholder="Search companies, clients, projects, quotation REF, PO number…"
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
            <p className="text-sm text-magic-ink/60">Searching…</p>
          ) : total === 0 ? (
            <p className="text-sm text-magic-ink/60">
              No matches for &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <>
              <div className="text-xs text-magic-ink/50">
                {total} match{total === 1 ? "" : "es"} for &ldquo;{query}&rdquo;
              </div>

              <CompaniesSection items={results.companies} />
              <ClientsSection items={results.folders} />
              <ProjectsSection items={results.projects} />
              <QuotationsSection items={results.quotations} />
              <PurchaseOrdersSection items={results.purchaseOrders} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-magic-ink/60">
      {label} ({count})
    </h3>
  );
}

function Kind({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] uppercase tracking-wide rounded-full bg-magic-soft px-2 py-0.5 text-magic-ink/60">
      {children}
    </span>
  );
}

function CompaniesSection({ items }: { items: CompanyHit[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <SectionHeader label="Companies" count={items.length} />
      <ul className="space-y-1.5">
        {items.map((c) => (
          <li key={`co-${c.id}`}>
            <Link
              href={`/crm/company/${c.id}`}
              className="block rounded-lg border border-magic-border px-3 py-2 hover:border-magic-red hover:bg-magic-soft/40 transition-colors"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-magic-ink">
                  {c.name}
                </span>
                <Kind>Company</Kind>
              </div>
              {(c.industry || c.website) && (
                <div className="text-xs text-magic-ink/60 mt-0.5">
                  {c.industry && <>{c.industry}</>}
                  {c.industry && c.website && <> · </>}
                  {c.website && <>{c.website}</>}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClientsSection({ items }: { items: FolderHit[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <SectionHeader label="Clients" count={items.length} />
      <ul className="space-y-1.5">
        {items.map((f) => {
          const base = folderBase(f.kind, f.company_id, f.id);
          return (
            <li key={`cl-${f.id}`}>
              <Link
                href={base}
                className="block rounded-lg border border-magic-border px-3 py-2 hover:border-magic-red hover:bg-magic-soft/40 transition-colors"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-magic-ink">
                    {f.name}
                  </span>
                  <Kind>
                    {f.kind === "company"
                      ? "Company contact"
                      : f.kind === "individual"
                        ? "Individual"
                        : "Unclassified"}
                  </Kind>
                </div>
                <div className="text-xs text-magic-ink/60 mt-0.5">
                  {f.company_name && <>@ {f.company_name} · </>}
                  {f.client_email && <>{f.client_email} · </>}
                  {f.client_phone && <>{f.client_phone}</>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ProjectsSection({ items }: { items: ProjectHit[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <SectionHeader label="Projects" count={items.length} />
      <ul className="space-y-1.5">
        {items.map((p) => {
          const base = folderBase(p.folder_kind, p.company_id, p.folder_id);
          const href = p.folder_kind ? `${base}/${p.id}` : base;
          return (
            <li key={`pr-${p.id}`}>
              <Link
                href={href}
                className="block rounded-lg border border-magic-border px-3 py-2 hover:border-magic-red hover:bg-magic-soft/40 transition-colors"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-magic-ink">
                    {p.name}
                  </span>
                  <Kind>Project</Kind>
                </div>
                <div className="text-xs text-magic-ink/60 mt-0.5">
                  {p.company_name && <>{p.company_name} · </>}
                  {p.folder_name && <>{p.folder_name}</>}
                </div>
                {p.description && (
                  <div className="text-xs text-magic-ink/50 mt-0.5 line-clamp-1">
                    {p.description}
                  </div>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function QuotationsSection({ items }: { items: QuotationHit[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <SectionHeader label="Quotations" count={items.length} />
      <ul className="space-y-1.5">
        {items.map((qq) => (
          <li key={`qq-${qq.id}`}>
            <Link
              href={quotationHref(qq)}
              className="block rounded-lg border border-magic-border px-3 py-2 hover:border-magic-red hover:bg-magic-soft/40 transition-colors"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-semibold text-sm text-magic-ink">
                  {qq.ref}
                </span>
                <Kind>Quotation</Kind>
                {qq.status && (
                  <span className="text-[10px] uppercase tracking-wide text-magic-ink/50">
                    {qq.status}
                  </span>
                )}
              </div>
              <div className="text-xs text-magic-ink/60 mt-0.5">
                {qq.client_name && <>{qq.client_name} · </>}
                {qq.project_name && <>{qq.project_name}</>}
              </div>
              {qq.company_name && (
                <div className="text-xs text-magic-ink/50 mt-0.5">
                  @ {qq.company_name}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PurchaseOrdersSection({ items }: { items: PoHit[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <SectionHeader label="Purchase orders" count={items.length} />
      <ul className="space-y-1.5">
        {items.map((po) => (
          <li key={`po-${po.id}`}>
            <Link
              href={poHref(po)}
              className="block rounded-lg border border-magic-border px-3 py-2 hover:border-magic-red hover:bg-magic-soft/40 transition-colors"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-semibold text-sm text-magic-ink">
                  {po.po_number}
                </span>
                <Kind>PO</Kind>
                {po.status && (
                  <span className="text-[10px] uppercase tracking-wide text-magic-ink/50">
                    {po.status}
                  </span>
                )}
              </div>
              <div className="text-xs text-magic-ink/60 mt-0.5">
                {po.supplier && <>{po.supplier} · </>}
                {po.client_name && <>{po.client_name} · </>}
                {po.project_name && <>{po.project_name}</>}
              </div>
              {po.company_name && (
                <div className="text-xs text-magic-ink/50 mt-0.5">
                  @ {po.company_name}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
