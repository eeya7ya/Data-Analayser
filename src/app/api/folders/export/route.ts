import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    const q = sql();
    const isAdmin = user.role === "admin";

    // Fetch folders — admins export everything, users only export their own.
    // Soft-deleted (trashed) folders and quotations are excluded from the
    // export so re-importing a backup doesn't resurrect items the user
    // chose to remove.
    type ExportedFolder = {
      id: number;
      name: string;
      client_email: string | null;
      client_phone: string | null;
      client_company: string | null;
    };
    const folders = isAdmin
      ? ((await q`
          select id, name, client_email, client_phone, client_company
          from client_folders
          where deleted_at is null
          order by name asc
        `) as ExportedFolder[])
      : ((await q`
          select id, name, client_email, client_phone, client_company
          from client_folders
          where owner_id = ${user.id} and deleted_at is null
          order by name asc
        `) as ExportedFolder[]);

    // Fetch quotations — same scope as folders.
    const quotations = isAdmin
      ? ((await q`
          select q.ref, q.project_name, q.client_name, q.client_email,
                 q.client_phone, q.sales_engineer, q.prepared_by, q.site_name,
                 q.tax_percent, q.items_json, q.totals_json, q.config_json,
                 q.folder_id, q.created_at, q.updated_at
          from quotations q
          where q.deleted_at is null
          order by q.folder_id nulls last, q.id
        `) as Array<Record<string, unknown>>)
      : ((await q`
          select q.ref, q.project_name, q.client_name, q.client_email,
                 q.client_phone, q.sales_engineer, q.prepared_by, q.site_name,
                 q.tax_percent, q.items_json, q.totals_json, q.config_json,
                 q.folder_id, q.created_at, q.updated_at
          from quotations q
          where q.owner_id = ${user.id} and q.deleted_at is null
          order by q.folder_id nulls last, q.id
        `) as Array<Record<string, unknown>>);

    // Build folder map
    const folderMap = new Map(folders.map((f) => [f.id, f.name]));

    // Group quotations by folder
    const folderGroups = new Map<string, unknown[]>();
    const unfiled: unknown[] = [];

    for (const row of quotations) {
      const stripped = {
        ref: row.ref,
        project_name: row.project_name,
        client_name: row.client_name,
        client_email: row.client_email,
        client_phone: row.client_phone,
        sales_engineer: row.sales_engineer,
        prepared_by: row.prepared_by,
        site_name: row.site_name,
        tax_percent: row.tax_percent,
        items_json: row.items_json,
        totals_json: row.totals_json,
        config_json: row.config_json,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };

      if (row.folder_id && folderMap.has(row.folder_id as number)) {
        const name = folderMap.get(row.folder_id as number)!;
        if (!folderGroups.has(name)) folderGroups.set(name, []);
        folderGroups.get(name)!.push(stripped);
      } else {
        unfiled.push(stripped);
      }
    }

    // Build export payload — `version: 2` carries the folder CRM columns.
    const payload = {
      version: 2,
      exported_at: new Date().toISOString(),
      folders: folders.map((f) => ({
        name: f.name,
        client_email: f.client_email,
        client_phone: f.client_phone,
        client_company: f.client_company,
        quotations: folderGroups.get(f.name) || [],
      })),
      unfiled_quotations: unfiled,
    };

    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="quotations-export-${date}.json"`,
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500 },
    );
  }
}
