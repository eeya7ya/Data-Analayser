import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

interface ExportedQuotation {
  ref: string;
  project_name: string;
  client_name?: string | null;
  client_email?: string | null;
  client_phone?: string | null;
  sales_engineer?: string | null;
  prepared_by?: string | null;
  site_name?: string;
  tax_percent?: number;
  items_json?: unknown;
  totals_json?: unknown;
  config_json?: unknown;
  created_at?: string;
  updated_at?: string;
}

interface ExportPayload {
  version: number;
  folders: Array<{ name: string; quotations: ExportedQuotation[] }>;
  unfiled_quotations: ExportedQuotation[];
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    await ensureSchema();
    const body = (await req.json()) as ExportPayload;

    if (body.version !== 1) {
      return NextResponse.json(
        { error: "Unsupported export version. Expected version 1." },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.folders)) {
      return NextResponse.json(
        { error: "Invalid export format: missing folders array." },
        { status: 400 },
      );
    }

    const q = sql();
    let foldersCreated = 0;
    let quotationsCreated = 0;
    let quotationsSkipped = 0;

    // Step 1: Create/resolve folders
    const folderIdMap = new Map<string, number>();
    for (const folder of body.folders) {
      const name = folder.name?.trim();
      if (!name) continue;

      // Try to insert, fall back to finding existing
      const inserted = (await q`
        insert into client_folders (name)
        values (${name})
        on conflict (name) do nothing
        returning id
      `) as Array<{ id: number }>;

      if (inserted.length > 0) {
        folderIdMap.set(name, inserted[0].id);
        foldersCreated++;
      } else {
        const existing = (await q`
          select id from client_folders where name = ${name} limit 1
        `) as Array<{ id: number }>;
        if (existing.length > 0) {
          folderIdMap.set(name, existing[0].id);
        }
      }
    }

    // Step 2: Import quotations
    async function importQuotation(qn: ExportedQuotation, folderId: number | null) {
      if (!qn.ref) {
        quotationsSkipped++;
        return;
      }

      // Check if ref already exists
      const dup = (await q`
        select id from quotations where ref = ${qn.ref} limit 1
      `) as Array<{ id: number }>;
      if (dup.length > 0) {
        quotationsSkipped++;
        return;
      }

      await q`
        insert into quotations (
          ref, owner_id, project_name, client_name, client_email, client_phone,
          sales_engineer, prepared_by, site_name, tax_percent,
          items_json, totals_json, config_json, folder_id
        ) values (
          ${qn.ref},
          ${user.id},
          ${qn.project_name || "Untitled Quotation"},
          ${qn.client_name || null},
          ${qn.client_email || null},
          ${qn.client_phone || null},
          ${qn.sales_engineer || null},
          ${qn.prepared_by || null},
          ${qn.site_name || "SITE"},
          ${qn.tax_percent ?? 16},
          ${JSON.stringify(qn.items_json || [])}::jsonb,
          ${JSON.stringify(qn.totals_json || {})}::jsonb,
          ${JSON.stringify(qn.config_json || {})}::jsonb,
          ${folderId}
        )
      `;
      quotationsCreated++;
    }

    // Import folder quotations
    for (const folder of body.folders) {
      const folderId = folderIdMap.get(folder.name?.trim()) || null;
      for (const qn of folder.quotations || []) {
        await importQuotation(qn, folderId);
      }
    }

    // Import unfiled quotations
    for (const qn of body.unfiled_quotations || []) {
      await importQuotation(qn, null);
    }

    return NextResponse.json({
      ok: true,
      folders_created: foldersCreated,
      quotations_created: quotationsCreated,
      quotations_skipped: quotationsSkipped,
    });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500 },
    );
  }
}
