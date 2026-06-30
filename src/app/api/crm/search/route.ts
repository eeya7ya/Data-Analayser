import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema, usingD1, rawBinder } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { tokenize } from "@/lib/search";
import { isFtsReady, matchAll, ftsPredicate, type FtsTable } from "@/lib/fts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Bind = (value: string | number) => string;

/**
 * Free-text haystack predicate for a bucket: an FTS5 MATCH on D1 (one
 * inverted-index lookup) when the index is ready, otherwise the original ILIKE
 * OR-chain across the listed columns (Postgres / pre-index). `idCol` and the
 * column expressions are literals; only the search text is bound.
 */
function haystack(
  useFts: boolean,
  table: FtsTable,
  idCol: string,
  cols: string[],
  search: string,
  P: Bind,
): string {
  if (useFts) {
    const match = matchAll(tokenize(search));
    if (match) return ftsPredicate(table, idCol, P(match));
  }
  const like = `%${search}%`;
  return "(" + cols.map((c) => `${c} ilike ${P(like)}`).join(" or ") + ")";
}

/**
 * Unified CRM search. One round-trip across companies, client folders,
 * projects, quotations and purchase orders so the /crm landing page
 * can let users jump straight to a record by name, ref, PO number,
 * contact email, project name, etc. — without manually drilling.
 *
 * Each result row carries enough context (folder kind, company_id,
 * project_id, ref/number) to build the CRM detail URL client-side.
 *
 * Owner isolation matches the underlying list endpoints: non-admins
 * only see rows they own. Per-bucket limits keep payload bounded
 * even on broad queries like a one-letter search.
 */

const PER_BUCKET_LIMIT = 25;

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

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireModuleAllowLegacy(user, "crm");

    const search = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (!search) {
      return NextResponse.json({
        companies: [],
        folders: [],
        projects: [],
        quotations: [],
        purchaseOrders: [],
      });
    }

    const q = sql();
    const isAdmin = canReadAll(user);
    const ownerFilter = isAdmin ? null : user.id;
    const limit = PER_BUCKET_LIMIT;
    const useFts = usingD1() && isFtsReady();

    // Each bucket is a small scan, now backed by FTS5 on D1 (the ILIKE
    // OR-chain was a full table scan that D1 bills per row). Each query gets its
    // own param binder; owner scope is added in JS so there's no `is null` cast.
    const companiesQ = (): Promise<CompanyHit[]> => {
      const { P, params } = rawBinder();
      const scope = ownerFilter === null ? "" : `and owner_id = ${P(ownerFilter)} `;
      const hay = haystack(
        useFts,
        "companies",
        "id",
        ["name", "coalesce(website, '')", "coalesce(industry, '')", "coalesce(notes, '')"],
        search,
        P,
      );
      return q.unsafe(
        `select id, name, website, industry
         from companies
         where deleted_at is null ${scope}and ${hay}
         order by name
         limit ${P(limit)}`,
        params,
      ) as unknown as Promise<CompanyHit[]>;
    };

    const foldersQ = (): Promise<FolderHit[]> => {
      const { P, params } = rawBinder();
      const scope = ownerFilter === null ? "" : `and cf.owner_id = ${P(ownerFilter)} `;
      const hay = haystack(
        useFts,
        "client_folders",
        "cf.id",
        [
          "cf.name",
          "coalesce(cf.client_email, '')",
          "coalesce(cf.client_phone, '')",
          "coalesce(cf.client_company, '')",
        ],
        search,
        P,
      );
      return q.unsafe(
        `select cf.id, cf.name, cf.kind, cf.company_id,
                c.name as company_name,
                cf.client_email, cf.client_phone
         from client_folders cf
         left join companies c on c.id = cf.company_id and c.deleted_at is null
         where cf.deleted_at is null ${scope}and ${hay}
         order by cf.name
         limit ${P(limit)}`,
        params,
      ) as unknown as Promise<FolderHit[]>;
    };

    const projectsQ = (): Promise<ProjectHit[]> => {
      const { P, params } = rawBinder();
      const scope = ownerFilter === null ? "" : `and p.owner_id = ${P(ownerFilter)} `;
      const hay = haystack(
        useFts,
        "projects",
        "p.id",
        ["p.name", "coalesce(p.description, '')"],
        search,
        P,
      );
      return q.unsafe(
        `select p.id, p.name, p.description,
                p.folder_id,
                cf.name as folder_name,
                cf.kind as folder_kind,
                cf.company_id,
                c.name as company_name
         from projects p
         join client_folders cf on cf.id = p.folder_id and cf.deleted_at is null
         left join companies c on c.id = cf.company_id and c.deleted_at is null
         where p.deleted_at is null ${scope}and ${hay}
         order by p.name
         limit ${P(limit)}`,
        params,
      ) as unknown as Promise<ProjectHit[]>;
    };

    const quotationsQ = (): Promise<QuotationHit[]> => {
      const { P, params } = rawBinder();
      const scope = ownerFilter === null ? "" : `and qq.owner_id = ${P(ownerFilter)} `;
      const hay = haystack(
        useFts,
        "quotations",
        "qq.id",
        ["qq.ref", "coalesce(qq.client_name, '')", "coalesce(qq.project_name, '')"],
        search,
        P,
      );
      return q.unsafe(
        `select qq.id, qq.ref, qq.client_name, qq.project_name, qq.status,
                qq.folder_id,
                coalesce(
                  qq.project_id,
                  (select min(p.id) from projects p
                    where p.folder_id = qq.folder_id and p.deleted_at is null)
                ) as project_id,
                cf.kind as folder_kind,
                cf.company_id,
                c.name as company_name
         from quotations qq
         left join client_folders cf on cf.id = qq.folder_id and cf.deleted_at is null
         left join companies c on c.id = cf.company_id and c.deleted_at is null
         where qq.deleted_at is null ${scope}and ${hay}
         order by qq.created_at desc
         limit ${P(limit)}`,
        params,
      ) as unknown as Promise<QuotationHit[]>;
    };

    const posQ = (): Promise<PoHit[]> => {
      const { P, params } = rawBinder();
      const scope = ownerFilter === null ? "" : `and po.owner_id = ${P(ownerFilter)} `;
      const hay = haystack(
        useFts,
        "purchase_orders",
        "po.id",
        [
          "po.po_number",
          "coalesce(po.supplier, '')",
          "coalesce(po.client_name, '')",
          "coalesce(po.project_name, '')",
        ],
        search,
        P,
      );
      return q.unsafe(
        `select po.id, po.po_number, po.supplier, po.client_name, po.project_name, po.status,
                po.folder_id,
                coalesce(
                  po.project_id,
                  (select min(p.id) from projects p
                    where p.folder_id = po.folder_id and p.deleted_at is null)
                ) as project_id,
                cf.kind as folder_kind,
                cf.company_id,
                c.name as company_name
         from purchase_orders po
         left join client_folders cf on cf.id = po.folder_id and cf.deleted_at is null
         left join companies c on c.id = cf.company_id and c.deleted_at is null
         where po.deleted_at is null ${scope}and ${hay}
         order by po.created_at desc
         limit ${P(limit)}`,
        params,
      ) as unknown as Promise<PoHit[]>;
    };

    const [companies, folders, projects, quotations, pos] = await Promise.all([
      companiesQ(),
      foldersQ(),
      projectsQ(),
      quotationsQ(),
      posQ(),
    ]);

    return NextResponse.json({
      companies,
      folders,
      projects,
      quotations,
      purchaseOrders: pos,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
