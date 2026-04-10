import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    await ensureSchema();
    const q = sql();

    // Fetch all folders
    const folders = (await q`
      select id, name from client_folders order by name asc
    `) as Array<{ id: number; name: string }>;

    // Fetch all quotations with folder info
    const quotations = (await q`
      select q.ref, q.project_name, q.client_name, q.client_email,
             q.client_phone, q.sales_engineer, q.prepared_by, q.site_name,
             q.tax_percent, q.items_json, q.totals_json, q.config_json,
             q.folder_id, q.created_at, q.updated_at
      from quotations q
      order by q.folder_id nulls last, q.id
    `) as Array<Record<string, unknown>>;

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

    // Build export payload
    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      folders: folders.map((f) => ({
        name: f.name,
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
