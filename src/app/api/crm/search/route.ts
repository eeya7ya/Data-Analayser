import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const like = `%${search}%`;
    const limit = PER_BUCKET_LIMIT;

    // Five small parallel scans. Each table has indexes on owner_id /
    // folder_id / project_id; the ILIKE patterns are short enough that
    // the planner uses a seq-scan + filter cheaply at current scale.
    const [companies, folders, projects, quotations, pos] = await Promise.all([
      q`
        select id, name, website, industry
        from companies
        where deleted_at is null
          and (${ownerFilter}::int is null or owner_id = ${ownerFilter})
          and (
            name ilike ${like}
            or coalesce(website, '') ilike ${like}
            or coalesce(industry, '') ilike ${like}
            or coalesce(notes, '') ilike ${like}
          )
        order by name
        limit ${limit}
      ` as unknown as Promise<CompanyHit[]>,

      q`
        select cf.id, cf.name, cf.kind, cf.company_id,
               c.name as company_name,
               cf.client_email, cf.client_phone
        from client_folders cf
        left join companies c on c.id = cf.company_id and c.deleted_at is null
        where cf.deleted_at is null
          and (${ownerFilter}::int is null or cf.owner_id = ${ownerFilter})
          and (
            cf.name ilike ${like}
            or coalesce(cf.client_email, '') ilike ${like}
            or coalesce(cf.client_phone, '') ilike ${like}
            or coalesce(cf.client_company, '') ilike ${like}
          )
        order by cf.name
        limit ${limit}
      ` as unknown as Promise<FolderHit[]>,

      q`
        select p.id, p.name, p.description,
               p.folder_id,
               cf.name as folder_name,
               cf.kind as folder_kind,
               cf.company_id,
               c.name as company_name
        from projects p
        join client_folders cf on cf.id = p.folder_id and cf.deleted_at is null
        left join companies c on c.id = cf.company_id and c.deleted_at is null
        where p.deleted_at is null
          and (${ownerFilter}::int is null or p.owner_id = ${ownerFilter})
          and (
            p.name ilike ${like}
            or coalesce(p.description, '') ilike ${like}
          )
        order by p.name
        limit ${limit}
      ` as unknown as Promise<ProjectHit[]>,

      q`
        select qq.id, qq.ref, qq.client_name, qq.project_name, qq.status,
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
        where qq.deleted_at is null
          and (${ownerFilter}::int is null or qq.owner_id = ${ownerFilter})
          and (
            qq.ref ilike ${like}
            or coalesce(qq.client_name, '') ilike ${like}
            or coalesce(qq.project_name, '') ilike ${like}
          )
        order by qq.created_at desc
        limit ${limit}
      ` as unknown as Promise<QuotationHit[]>,

      q`
        select po.id, po.po_number, po.supplier, po.client_name, po.project_name, po.status,
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
        where po.deleted_at is null
          and (${ownerFilter}::int is null or po.owner_id = ${ownerFilter})
          and (
            po.po_number ilike ${like}
            or coalesce(po.supplier, '') ilike ${like}
            or coalesce(po.client_name, '') ilike ${like}
            or coalesce(po.project_name, '') ilike ${like}
          )
        order by po.created_at desc
        limit ${limit}
      ` as unknown as Promise<PoHit[]>,
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
