import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { canAuthorQuotation, hasModule } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where a client folder sits in the CRM, exactly as the app routes it. */
type FolderSection = "company" | "individual" | "unclassified";

interface FolderRow {
  id: number;
  name: string;
  kind: string | null;
  company_id: number | null;
}

/**
 * GET /api/sync/manifest
 *
 * Everything the member's local "sync folder" should hold (see fsSync.ts),
 * laid out like the app's CRM tree:
 *
 *   Companies/<Company>/<Person>/<Project> [#id]/…
 *   Individual clients/<Client>/<Project> [#id]/…
 *   Unclassified clients/<Client>/<Project> [#id]/…
 *
 *   - `companies` / `folders` / `projects` — the tree. Projects are the ones
 *     the CRM lists for this member (owned, in a client folder they own, or
 *     assigned to them); admins get everything. Each folder carries the
 *     section and company the app files it under — `client_folders.company_id`
 *     first, then a person linked to a company through `contacts` (the app
 *     heals that link lazily, but already lists the person at the company).
 *   - `files` — uploaded documents the member can actually open, i.e. the same
 *     rule as the per-file presign in /api/project-files/[id] (`canReadFile`):
 *     their own uploads, files a deal counterpart shared with them, and files
 *     shared to projects for projects-module / assigned members. Listing only
 *     openable files is what keeps a sync pass free of "not found" errors.
 *     `placements` are the project folders the file shows in: its own project
 *     and/or the member's lead-linked sales ↔ presales project, as the app's
 *     BOQs / Files tab does.
 *   - `quotations` — in-app quotations (not stored as files); the full
 *     items_json / config_json ride along so the client builds the .xlsx.
 *     `canView` mirrors the single-quotation read in /api/quotations: only a
 *     quotation the member can open in the viewer gets the read-only PDF,
 *     which the client renders from that viewer.
 *   - `pricingProjects` — the Pricing module, rendered into `_Pricing/`.
 *
 * The flat `clientName` / `projectName` fields of the previous manifest are
 * still sent, so a tab that loaded the old sync code before a deploy keeps
 * working in the old layout until it is reloaded.
 *
 * Metadata only — file bytes are fetched per file through the access-checked
 * presign. Read-only. No id lists are bound into the SQL: D1 caps a query at
 * ~100 bound parameters, so scoping is done with joins and resolved here.
 */
export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    const q = sql();
    const all = canReadAll(user);
    const uid = user.id;
    const [hasProjects, canAuthorQuotations] = await Promise.all([
      all ? Promise.resolve(true) : hasModule(uid, "projects"),
      canAuthorQuotation(user),
    ]);

    // ── Reference data for placing folders ────────────────────────────────
    const companyRows = (await q`
      select id, name, owner_id from companies where deleted_at is null
    `) as Array<{ id: number; name: string; owner_id: number | null }>;
    const companies = new Map(companyRows.map((c) => [Number(c.id), c]));

    // Person ↔ company links through contacts (first live link per folder).
    const contactCompany = new Map<number, number>();
    try {
      const links = (await q`
        select folder_id, company_id from contacts
        where deleted_at is null
          and folder_id is not null and company_id is not null
        order by id asc
      `) as Array<{ folder_id: number; company_id: number }>;
      for (const l of links) {
        const fid = Number(l.folder_id);
        const cid = Number(l.company_id);
        if (!contactCompany.has(fid) && companies.has(cid)) {
          contactCompany.set(fid, cid);
        }
      }
    } catch {
      /* contacts table missing on a very old DB — company_id alone decides */
    }

    // Lead-linked sales ↔ presales project pairs (the shared file workspace).
    const linked = new Map<number, Set<number>>();
    try {
      const leadRows = (await q`
        select project_id, sales_project_id from leads
        where deleted_at is null
          and project_id is not null and sales_project_id is not null
      `) as Array<{ project_id: number; sales_project_id: number }>;
      for (const l of leadRows) {
        const a = Number(l.project_id);
        const b = Number(l.sales_project_id);
        if (a === b) continue;
        if (!linked.has(a)) linked.set(a, new Set());
        if (!linked.has(b)) linked.set(b, new Set());
        linked.get(a)!.add(b);
        linked.get(b)!.add(a);
      }
    } catch {
      /* no leads table — nothing is linked */
    }

    // ── The tree ──────────────────────────────────────────────────────────
    const folders = new Map<number, FolderRow>();
    const addFolder = (f: {
      id: unknown;
      name: unknown;
      kind: unknown;
      company_id: unknown;
    }) => {
      const id = Number(f.id);
      if (!Number.isFinite(id) || folders.has(id)) return;
      folders.set(id, {
        id,
        name: String(f.name ?? ""),
        kind: f.kind ? String(f.kind) : null,
        company_id:
          f.company_id === null || f.company_id === undefined
            ? null
            : Number(f.company_id),
      });
    };
    const projects = new Map<
      number,
      { id: number; name: string; folderId: number }
    >();
    const addProject = (p: { id: unknown; name: unknown; folder_id: unknown }) => {
      const id = Number(p.id);
      if (!Number.isFinite(id) || projects.has(id)) return;
      projects.set(id, {
        id,
        name: String(p.name ?? ""),
        folderId: Number(p.folder_id),
      });
    };

    // Client folders the member owns (shown even before they hold a project).
    const ownedFolders = (await q`
      select id, name, kind, company_id from client_folders
      where deleted_at is null
        and (${all}::boolean = true or owner_id = ${uid})
    `) as Array<{ id: unknown; name: unknown; kind: unknown; company_id: unknown }>;
    ownedFolders.forEach((f) => addFolder(f));

    // Projects the CRM lists for the member.
    const treeProjects = (await q`
      select p.id, p.name, p.folder_id,
             cf.name as folder_name, cf.kind as folder_kind,
             cf.company_id as folder_company_id
      from projects p
      join client_folders cf on cf.id = p.folder_id and cf.deleted_at is null
      where p.deleted_at is null
        and (
          ${all}::boolean = true
          or p.owner_id = ${uid}
          or cf.owner_id = ${uid}
          or exists (
                select 1 from project_assignments pa
                where pa.project_id = p.id
                  and pa.user_id = ${uid} and pa.deleted_at is null)
        )
      order by p.id asc
    `) as Array<Record<string, unknown>>;
    for (const r of treeProjects) {
      addFolder({
        id: r.folder_id,
        name: r.folder_name,
        kind: r.folder_kind,
        company_id: r.folder_company_id,
      });
      addProject(r as { id: unknown; name: unknown; folder_id: unknown });
    }
    const inTree = new Set(projects.keys());

    /** Project folders a file / quotation on `projectId` shows in. */
    const placementsFor = (projectId: number): number[] => {
      const out = [projectId, ...(linked.get(projectId) ?? [])].filter((id) =>
        inTree.has(id),
      );
      return out.length > 0 ? [...new Set(out)] : [projectId];
    };

    // ── Files the member can open (mirrors canReadFile) ───────────────────
    type FileRow = {
      id: number;
      project_id: number;
      kind: string;
      filename: string;
      mime: string;
      size_bytes: number;
      project_name: string;
      folder_id: number;
      folder_name: string;
      folder_kind: string | null;
      folder_company_id: number | null;
    };
    let fileRows: FileRow[];
    try {
      fileRows = (await q`
        select pf.id, pf.project_id, pf.kind, pf.filename, pf.mime, pf.size_bytes,
               p.name as project_name, p.folder_id,
               cf.name as folder_name, cf.kind as folder_kind,
               cf.company_id as folder_company_id
        from project_files pf
        join projects p on p.id = pf.project_id and p.deleted_at is null
        join client_folders cf on cf.id = p.folder_id and cf.deleted_at is null
        where pf.deleted_at is null
          and (
            ${all}::boolean = true
            or pf.owner_id = ${uid}
            or (pf.shared_with_counterpart = true and exists (
                  select 1 from leads l
                  join projects lp on lp.id = case
                        when l.project_id = pf.project_id then l.sales_project_id
                        when l.sales_project_id = pf.project_id then l.project_id
                      end
                  join client_folders lcf on lcf.id = lp.folder_id
                  where l.deleted_at is null and lp.deleted_at is null
                    and (l.project_id = pf.project_id or l.sales_project_id = pf.project_id)
                    and (lp.owner_id = ${uid} or lcf.owner_id = ${uid})))
            or (pf.shared_to_projects = true and (
                  ${hasProjects}::boolean = true
                  or exists (
                    select 1 from project_assignments pa
                    where pa.project_id = pf.project_id
                      and pa.user_id = ${uid} and pa.deleted_at is null)))
          )
        order by pf.id asc
        limit 5000
      `) as FileRow[];
    } catch {
      // A DB without the V1.8 shared_with_counterpart column: the presign
      // treats the flag as false, so leave that branch out here too.
      fileRows = (await q`
        select pf.id, pf.project_id, pf.kind, pf.filename, pf.mime, pf.size_bytes,
               p.name as project_name, p.folder_id,
               cf.name as folder_name, cf.kind as folder_kind,
               cf.company_id as folder_company_id
        from project_files pf
        join projects p on p.id = pf.project_id and p.deleted_at is null
        join client_folders cf on cf.id = p.folder_id and cf.deleted_at is null
        where pf.deleted_at is null
          and (
            ${all}::boolean = true
            or pf.owner_id = ${uid}
            or (pf.shared_to_projects = true and (
                  ${hasProjects}::boolean = true
                  or exists (
                    select 1 from project_assignments pa
                    where pa.project_id = pf.project_id
                      and pa.user_id = ${uid} and pa.deleted_at is null)))
          )
        order by pf.id asc
        limit 5000
      `) as FileRow[];
    }

    // ── Quotations (scope unchanged from the previous manifest) ───────────
    const quotationRows = (await q`
      select q.id, q.ref, q.project_id, q.tax_percent, q.updated_at,
             q.owner_id, q.sent_to_sales_to, q.sales_accepted_by,
             exists (
               select 1 from leads vl
               where vl.created_by = ${uid} and vl.project_id = q.project_id
                 and vl.deleted_at is null
             ) as lead_viewer,
             q.client_name, q.client_email, q.client_phone,
             q.sales_engineer, q.prepared_by, q.project_name,
             q.items_json, q.config_json,
             p.id as live_project_id, p.name as live_project_name,
             p.folder_id as project_folder_id,
             cf.name as project_folder_name, cf.kind as project_folder_kind,
             cf.company_id as project_folder_company_id,
             qf.id as quote_folder_id, qf.name as quote_folder_name,
             qf.kind as quote_folder_kind, qf.company_id as quote_folder_company_id,
             coalesce(p.name, q.project_name, 'Project') as project_folder,
             coalesce(cf.name, qf.name, q.client_name, 'Client') as client_folder
      from quotations q
      left join projects p on p.id = q.project_id and p.deleted_at is null
      left join client_folders cf on cf.id = p.folder_id and cf.deleted_at is null
      left join client_folders qf on qf.id = q.folder_id and qf.deleted_at is null
      where q.deleted_at is null
        and (
          ${all}::boolean = true
          or q.owner_id = ${uid}
          or p.owner_id = ${uid}
          or cf.owner_id = ${uid}
          or qf.owner_id = ${uid}
          or exists (
                select 1 from leads l
                join projects lp on lp.id = case
                      when l.project_id = q.project_id then l.sales_project_id
                      when l.sales_project_id = q.project_id then l.project_id
                    end
                join client_folders lcf on lcf.id = lp.folder_id
                where l.deleted_at is null and q.project_id is not null
                  and (l.project_id = q.project_id or l.sales_project_id = q.project_id)
                  and (lp.owner_id = ${uid} or lcf.owner_id = ${uid}))
        )
      order by q.created_at desc
      limit 5000
    `) as Array<Record<string, unknown>>;

    // ── Place files + quotations, pulling in any project they live on ─────
    const filesOut = fileRows.map((r) => {
      const projectId = Number(r.project_id);
      const placements = placementsFor(projectId);
      if (!inTree.has(projectId) && placements.length === 1 && placements[0] === projectId) {
        addFolder({
          id: r.folder_id,
          name: r.folder_name,
          kind: r.folder_kind,
          company_id: r.folder_company_id,
        });
        addProject({ id: projectId, name: r.project_name, folder_id: r.folder_id });
      }
      return {
        id: Number(r.id),
        projectId,
        placements,
        kind: String(r.kind || "other"),
        filename: r.filename,
        mime: r.mime,
        sizeBytes: Number(r.size_bytes) || 0,
        // Previous-manifest fields (old tabs).
        projectName: r.project_name || "Project",
        clientName: r.folder_name || "Client",
      };
    });

    const quotationsOut = quotationRows.map((r) => {
      const liveProjectId =
        r.live_project_id === null || r.live_project_id === undefined
          ? null
          : Number(r.live_project_id);
      let placements: number[] = [];
      let folderId: number | null = null;
      if (liveProjectId !== null) {
        placements = placementsFor(liveProjectId);
        if (!inTree.has(liveProjectId) && placements.length === 1 && placements[0] === liveProjectId) {
          addFolder({
            id: r.project_folder_id,
            name: r.project_folder_name,
            kind: r.project_folder_kind,
            company_id: r.project_folder_company_id,
          });
          addProject({
            id: liveProjectId,
            name: r.live_project_name,
            folder_id: r.project_folder_id,
          });
        }
      } else if (r.quote_folder_id !== null && r.quote_folder_id !== undefined) {
        // Not filed under a live project — goes in its client folder.
        folderId = Number(r.quote_folder_id);
        addFolder({
          id: r.quote_folder_id,
          name: r.quote_folder_name,
          kind: r.quote_folder_kind,
          company_id: r.quote_folder_company_id,
        });
      }
      const isUser = (v: unknown) => v !== null && v !== undefined && Number(v) === Number(uid);
      return {
        id: Number(r.id),
        ref: String(r.ref ?? `quotation-${r.id}`),
        projectId: r.project_id === null ? null : Number(r.project_id),
        placements,
        folderId,
        canView:
          all ||
          isUser(r.owner_id) ||
          isUser(r.sent_to_sales_to) ||
          isUser(r.sales_accepted_by) ||
          Boolean(Number(r.lead_viewer)),
        // Previous-manifest fields (old tabs) — also the fallback client name
        // for a quotation that has neither a project nor a folder.
        projectName: String(r.project_folder || "Project"),
        clientName: String(r.client_folder || "Client"),
        updatedAt: r.updated_at ? String(r.updated_at) : "",
        // Full row for the offline Excel build (quotationExcelInputFromRow).
        row: {
          ref: r.ref,
          project_name: r.project_name,
          client_name: r.client_name,
          client_email: r.client_email,
          client_phone: r.client_phone,
          sales_engineer: r.sales_engineer,
          prepared_by: r.prepared_by,
          tax_percent: r.tax_percent,
          items_json: r.items_json,
          config_json: r.config_json,
        },
      };
    });

    // ── Section + company for every folder in the tree ───────────────────
    const usedCompanies = new Set<number>();
    const foldersOut = [...folders.values()].map((f) => {
      let section: FolderSection = "unclassified";
      let companyId: number | null = null;
      if (f.company_id !== null && companies.has(f.company_id)) {
        section = "company";
        companyId = f.company_id;
      } else if (f.kind !== "individual" && contactCompany.has(f.id)) {
        section = "company";
        companyId = contactCompany.get(f.id)!;
      } else if (f.kind === "individual") {
        section = "individual";
      }
      if (companyId !== null) usedCompanies.add(companyId);
      return { id: f.id, name: f.name, section, companyId };
    });
    // Companies the member owns are listed even with nobody in them yet.
    const companiesOut = companyRows
      .filter(
        (c) =>
          usedCompanies.has(Number(c.id)) || all || Number(c.owner_id) === Number(uid),
      )
      .map((c) => ({ id: Number(c.id), name: String(c.name ?? "") }));

    // Pricing-module priced projects. These live in their OWN tables
    // (pricing_projects + product lines + a constants snapshot), entirely
    // separate from CRM quotations, so they were previously invisible to the
    // sync folder. Scope mirrors files/quotations: a member syncs the priced
    // projects they own; admins get everything. Fault-isolated — if the
    // pricing tables aren't present on a deployment, the rest of the manifest
    // still returns. The client renders each into `_Pricing/<Manufacturer>/…`.
    let pricingOut: Array<Record<string, unknown>> = [];
    try {
      const projectRows = (await q`
        select pp.id, pp.name, pp.responsible_person,
               m.name as manufacturer_name,
               coalesce(pc.currency_rate, 0.71)   as currency_rate,
               coalesce(pc.shipping_rate, 0.15)   as shipping_rate,
               coalesce(pc.customs_rate, 0.12)    as customs_rate,
               coalesce(pc.profit_margin, 0.25)   as profit_margin,
               coalesce(pc.tax_rate, 0.16)        as tax_rate,
               coalesce(pc.target_currency, 'JOD') as target_currency
        from pricing_projects pp
        join pricing_manufacturers m on m.id = pp.manufacturer_id
        left join pricing_project_constants pc on pc.project_id = pp.id
        where pp.deleted_at is null
          and (${all}::boolean = true or pp.user_id = ${uid})
        order by m.name asc, pp.name asc
        limit 2000
      `) as Array<Record<string, unknown>>;

      const pids = projectRows.map((r) => Number(r.id));
      const linesByProject = new Map<number, Array<Record<string, unknown>>>();
      // D1 expands the id array into one bound parameter per id and rejects a
      // statement with more than ~100, so the ids go in batches of 90.
      for (let i = 0; i < pids.length; i += 90) {
        const batch = pids.slice(i, i + 90);
        const lineRows = (await q`
          select project_id, position, item_model, price_usd, quantity,
                 shipping_override, customs_override,
                 shipping_rate_override, customs_rate_override,
                 profit_rate_override
          from pricing_product_lines
          where project_id = any(${batch}::int[])
          order by project_id asc, position asc
        `) as Array<Record<string, unknown>>;
        for (const l of lineRows) {
          const pid = Number(l.project_id);
          if (!linesByProject.has(pid)) linesByProject.set(pid, []);
          linesByProject.get(pid)!.push(l);
        }
      }

      const numOrNull = (v: unknown): number | null =>
        v === null || v === undefined ? null : Number(v);

      pricingOut = projectRows.map((r) => {
        const id = Number(r.id);
        const rows = (linesByProject.get(id) ?? []).map((l) => ({
          position: Number(l.position) || 0,
          itemModel: String(l.item_model ?? ""),
          priceUsd: Number(l.price_usd) || 0,
          quantity: Number(l.quantity) || 0,
          shippingOverride: numOrNull(l.shipping_override),
          customsOverride: numOrNull(l.customs_override),
          shippingRateOverride: numOrNull(l.shipping_rate_override),
          customsRateOverride: numOrNull(l.customs_rate_override),
          profitRateOverride: numOrNull(l.profit_rate_override),
        }));
        // Content fingerprint so the client re-exports only when something
        // actually changed (pricing_projects has no updated_at, and the lines
        // live in a child table, so mtime alone can't signal a change).
        const fingerprint = JSON.stringify({
          n: r.name,
          rp: r.responsible_person,
          c: [
            r.currency_rate,
            r.shipping_rate,
            r.customs_rate,
            r.profit_margin,
            r.tax_rate,
            r.target_currency,
          ],
          rows,
        });
        return {
          id,
          name: String(r.name ?? `project-${id}`),
          manufacturerName: String(r.manufacturer_name ?? "Manufacturer"),
          responsiblePerson: r.responsible_person
            ? String(r.responsible_person)
            : null,
          targetCurrency: String(r.target_currency ?? "JOD"),
          constants: {
            currencyRate: Number(r.currency_rate),
            shippingRate: Number(r.shipping_rate),
            customsRate: Number(r.customs_rate),
            profitMargin: Number(r.profit_margin),
            taxRate: Number(r.tax_rate),
          },
          rows,
          fingerprint,
        };
      });
    } catch {
      // Pricing tables missing / query shape mismatch — skip pricing sync,
      // the files + quotations manifest still returns normally.
      pricingOut = [];
    }

    return NextResponse.json({
      version: 2,
      canAuthorQuotations,
      companies: companiesOut,
      folders: foldersOut,
      projects: [...projects.values()],
      files: filesOut,
      quotations: quotationsOut,
      pricingProjects: pricingOut,
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
