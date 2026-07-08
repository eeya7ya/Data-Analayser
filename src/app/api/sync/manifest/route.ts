import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { hasModule } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sync/manifest
 *
 * Everything the member's local "sync folder" should hold (see fsSync.ts):
 *
 *   - `files`      — uploaded documents (project_files). Scope: their own
 *                    uploads, files under clients/projects they own, shared
 *                    files on projects they can reach via the projects module
 *                    or an assignment, and files on the linked sales↔presales
 *                    counterpart of a deal they own.
 *   - `quotations` — their in-app quotations (which aren't stored as files).
 *                    The full items_json/config_json ride along so the client
 *                    can build the brand-matched .xlsx offline.
 *
 * Metadata only for files — the bytes are fetched per-file through the
 * access-checked `/api/project-files/[id]` presign, so a generous scope here
 * can't leak file contents. Read-only. Admins get everything.
 */
export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    const q = sql();
    const all = canReadAll(user);
    const uid = user.id;
    const hasProjects = all ? true : await hasModule(uid, "projects");

    const fileRows = (await q`
      select pf.id, pf.project_id, pf.filename, pf.mime, pf.size_bytes,
             p.name as project_name, cf.name as client_name
      from project_files pf
      join projects p on p.id = pf.project_id and p.deleted_at is null
      join client_folders cf on cf.id = p.folder_id and cf.deleted_at is null
      where pf.deleted_at is null
        and (
          ${all}::boolean = true
          or pf.owner_id = ${uid}
          or p.owner_id = ${uid}
          or cf.owner_id = ${uid}
          or (pf.shared_to_projects and ${hasProjects}::boolean = true)
          or (pf.shared_to_projects and exists (
                select 1 from project_assignments pa
                where pa.project_id = pf.project_id
                  and pa.user_id = ${uid} and pa.deleted_at is null))
          or exists (
                select 1 from leads l
                join projects lp on lp.id = case
                      when l.project_id = pf.project_id then l.sales_project_id
                      when l.sales_project_id = pf.project_id then l.project_id
                    end
                join client_folders lcf on lcf.id = lp.folder_id
                where l.deleted_at is null
                  and (l.project_id = pf.project_id or l.sales_project_id = pf.project_id)
                  and (lp.owner_id = ${uid} or lcf.owner_id = ${uid}))
        )
      order by cf.name asc, p.name asc, pf.filename asc
      limit 5000
    `) as Array<{
      id: number;
      project_id: number;
      filename: string;
      mime: string;
      size_bytes: number;
      project_name: string;
      client_name: string;
    }>;

    // Quotations aren't files — carry the full row so the client renders the
    // .xlsx offline. Scope mirrors the files: owned by the member, under a
    // client/project they own, or on the linked counterpart of their deal.
    const quotationRows = (await q`
      select q.id, q.ref, q.project_id, q.tax_percent, q.updated_at,
             q.client_name, q.client_email, q.client_phone,
             q.sales_engineer, q.prepared_by, q.project_name,
             q.items_json, q.config_json,
             coalesce(p.name, q.project_name, 'Project') as project_folder,
             coalesce(cf.name, qf.name, q.client_name, 'Client') as client_folder
      from quotations q
      left join projects p on p.id = q.project_id and p.deleted_at is null
      left join client_folders cf on cf.id = p.folder_id
      left join client_folders qf on qf.id = q.folder_id
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

    return NextResponse.json({
      files: fileRows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        projectName: r.project_name || "Project",
        clientName: r.client_name || "Client",
        filename: r.filename,
        mime: r.mime,
        sizeBytes: Number(r.size_bytes) || 0,
      })),
      quotations: quotationRows.map((r) => ({
        id: Number(r.id),
        ref: String(r.ref ?? `quotation-${r.id}`),
        projectId: r.project_id === null ? null : Number(r.project_id),
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
      })),
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
