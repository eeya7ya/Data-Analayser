import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";

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

interface ExportedFolder {
  name: string;
  // CRM fields — added in export version 2. Version-1 payloads omit them,
  // so every field is optional and defaults to null on import.
  client_email?: string | null;
  client_phone?: string | null;
  client_company?: string | null;
  quotations: ExportedQuotation[];
}

interface ExportPayload {
  version: number;
  folders: ExportedFolder[];
  unfiled_quotations: ExportedQuotation[];
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const body = (await req.json()) as ExportPayload;

    if (body.version !== 1 && body.version !== 2) {
      return NextResponse.json(
        { error: "Unsupported export version. Expected 1 or 2." },
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

    // Step 1: Create/resolve folders — always scoped to the importing user.
    // Folder rows in v2 carry CRM fields; v1 payloads just store the name.
    const folderIdMap = new Map<string, number>();
    for (const folder of body.folders) {
      const name = folder.name?.trim();
      if (!name) continue;
      const email = folder.client_email?.trim() || null;
      const phone = folder.client_phone?.trim() || null;
      const company = folder.client_company?.trim() || null;

      // Try to insert, fall back to finding existing (per-owner uniqueness).
      const inserted = (await q`
        insert into client_folders (name, owner_id, client_email, client_phone, client_company)
        values (${name}, ${user.id}, ${email}, ${phone}, ${company})
        on conflict (owner_id, name) do nothing
        returning id
      `) as Array<{ id: number }>;

      if (inserted.length > 0) {
        folderIdMap.set(name, inserted[0].id);
        foldersCreated++;
      } else {
        // Folder already exists — backfill any CRM fields that are missing
        // so re-importing a v2 export after a v1 export picks up contact info.
        const existing = (await q`
          update client_folders
          set client_email   = coalesce(client_email, ${email}),
              client_phone   = coalesce(client_phone, ${phone}),
              client_company = coalesce(client_company, ${company}),
              updated_at     = now()
          where name = ${name}
            and owner_id = ${user.id}
            and deleted_at is null
          returning id
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
          items_json, totals_json, config_json, folder_id,
          created_at, updated_at
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
          ${folderId},
          ${qn.created_at ? new Date(qn.created_at).toISOString() : new Date().toISOString()},
          ${qn.updated_at ? new Date(qn.updated_at).toISOString() : new Date().toISOString()}
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
