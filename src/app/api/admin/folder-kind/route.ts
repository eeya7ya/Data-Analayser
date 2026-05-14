import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin → Folder classification.
 *
 * GET   — every active client_folders row with kind/company_id/owner
 *         info and a quotation/project count so the admin can see what
 *         lives behind each folder before deciding company vs individual.
 *         Folders are returned in unclassified-first order so the
 *         migration quarantine queue floats to the top.
 *
 * PATCH — set or clear (kind, company_id) for one folder. The folder
 *         row itself is never deleted; passing kind=null re-opens it
 *         for re-classification (still no row mutation beyond these
 *         two columns).
 */

interface FolderListRow {
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

export async function GET() {
  try {
    await requireAdmin();
    await ensureSchema();
    const q = sql();

    const rows = (await q`
      select
        cf.id,
        cf.name,
        cf.kind,
        cf.company_id,
        c.name as company_name,
        u.username as owner_username,
        cf.client_company,
        cf.client_email,
        (select count(*) from quotations qq
           where qq.folder_id = cf.id and qq.deleted_at is null) as quotation_count,
        (select count(*) from projects p
           where p.folder_id = cf.id and p.deleted_at is null) as project_count
      from client_folders cf
      left join companies c on c.id = cf.company_id and c.deleted_at is null
      left join users u on u.id = cf.owner_id
      where cf.deleted_at is null
      order by (cf.kind is null) desc, cf.name asc
    `) as FolderListRow[];

    const companies = (await q`
      select id, name from companies
      where deleted_at is null
      order by name
    `) as Array<{ id: number; name: string }>;

    return NextResponse.json({ folders: rows, companies });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    await ensureSchema();

    const body = (await req.json()) as {
      folder_id?: number;
      kind?: "company" | "individual" | null;
      company_id?: number | null;
    };

    const folderId = Number(body.folder_id);
    if (!Number.isInteger(folderId) || folderId <= 0) {
      return NextResponse.json({ error: "invalid folder_id" }, { status: 400 });
    }

    // `kind` accepts the literal null sentinel so admins can "un-classify"
    // a folder (sending it back to the quarantine queue) if they realize
    // they got it wrong. The CHECK constraint allows null.
    if (
      body.kind !== null &&
      body.kind !== "company" &&
      body.kind !== "individual" &&
      body.kind !== undefined
    ) {
      return NextResponse.json({ error: "invalid kind" }, { status: 400 });
    }

    const q = sql();
    const existing = (await q`
      select id, kind, company_id from client_folders
      where id = ${folderId} and deleted_at is null
    `) as Array<{ id: number; kind: string | null; company_id: number | null }>;

    if (existing.length === 0) {
      return NextResponse.json({ error: "folder not found" }, { status: 404 });
    }

    const newKind = body.kind === undefined ? existing[0].kind : body.kind;
    const newCompanyId =
      body.company_id === undefined ? existing[0].company_id : body.company_id;

    // Individuals never link to a company; we null out company_id rather
    // than reject so the admin doesn't have to do a two-step.
    const effectiveCompanyId = newKind === "individual" ? null : newCompanyId;

    if (effectiveCompanyId !== null) {
      const companyCheck = (await q`
        select id from companies
        where id = ${effectiveCompanyId} and deleted_at is null
      `) as Array<{ id: number }>;
      if (companyCheck.length === 0) {
        return NextResponse.json(
          { error: "company not found" },
          { status: 404 },
        );
      }
    }

    await q`
      update client_folders
      set kind = ${newKind},
          company_id = ${effectiveCompanyId},
          updated_at = now()
      where id = ${folderId}
    `;

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${admin.id}, 'client_folder', ${folderId}, 'classify',
              ${JSON.stringify({
                kind: newKind,
                company_id: effectiveCompanyId,
                previous_kind: existing[0].kind,
                previous_company_id: existing[0].company_id,
              })}::jsonb)
    `;

    return NextResponse.json({
      ok: true,
      folder_id: folderId,
      kind: newKind,
      company_id: effectiveCompanyId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
