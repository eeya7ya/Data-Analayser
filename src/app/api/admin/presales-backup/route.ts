import { NextResponse } from "next/server";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import {
  downloadStorageObject,
  PROJECT_FILES_BUCKET,
  safeFilename,
} from "@/lib/storage";
import { fetchR2BytesForPath, isR2Configured } from "@/lib/file-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/admin/presales-backup
 *
 * One-click backup of EVERYTHING in the Presales workspace, in its original
 * format. The Presales module is the lead queue + the pricing sheets + the
 * quotations presales authors, so this bundles:
 *
 *   data/leads.{json,csv}                  every lead (the presales queue)
 *   data/quotations.{json,csv}             quotations authored by presales or
 *                                          linked to a lead (items/totals/config
 *                                          included verbatim — the original data)
 *   data/quotation_stock_checks.{json,csv} stock checks raised on those quotes
 *   data/pricing_*.{json,csv}              the per-manufacturer pricing sheets
 *   data/presales_users.{json,csv}         id / username / role lookup so the
 *                                          owner_id columns are human-readable
 *   files/<kind>/<id>-<name>               the ACTUAL uploaded bytes (PDF, Excel,
 *                                          DWG, …) for every BOQ / quotation / PO
 *                                          / attachment in presales — unchanged,
 *                                          in the original format they came in.
 *   files/_manifest.json                   path / size / sha256 / source per blob
 *   manifest.json + README.txt             what's inside and how it maps back
 *
 * Admin only (exposed from Admin → Export). Read-only on the database.
 */
export async function GET() {
  try {
    await requireAdmin();
    await ensureSchema();
    const q = sql();

    // ── Who counts as "presales" ───────────────────────────────────────────
    // Anyone holding a CRM presales grant, or any role in the pricing module
    // (the pricing sheets are a presales tool). Legacy admins are implicitly
    // included via their authored quotations below regardless.
    const presalesUserRows = (await q`
      select distinct u.id, u.username, u.role
      from users u
      join user_module_roles r on r.user_id = u.id and r.revoked_at is null
      where (r.module = 'crm' and r.role in ('presales', 'presales_manager'))
         or (r.module = 'pricing')
      order by u.id
    `) as Array<{ id: number; username: string; role: string }>;
    const presalesUserIds = presalesUserRows.map((u) => u.id);

    // ── The presales tables ─────────────────────────────────────────────────
    // Leads ARE the presales queue, so we take them all.
    const leads = (await q`
      select * from leads where deleted_at is null order by id
    `) as Array<Record<string, unknown>>;

    const leadProjectIds = leads
      .map((l) => l.project_id)
      .filter((v): v is number => typeof v === "number");
    const leadQuotationIds = leads
      .map((l) => l.quotation_id)
      .filter((v): v is number => typeof v === "number");

    // Quotations authored by a presales user OR attached to a lead.
    const quotations = (await q`
      select * from quotations
      where owner_id = any(${presalesUserIds}::int[])
         or id = any(${leadQuotationIds}::int[])
      order by id
    `) as Array<Record<string, unknown>>;
    const quotationIds = quotations
      .map((row) => row.id)
      .filter((v): v is number => typeof v === "number");

    const stockChecks = (await q`
      select * from quotation_stock_checks
      where quotation_id = any(${quotationIds}::int[])
      order by id
    `) as Array<Record<string, unknown>>;

    // Pricing workspaces — the whole pricing module belongs to presales.
    const pricingManufacturers = (await q`
      select * from pricing_manufacturers order by id
    `) as Array<Record<string, unknown>>;
    const pricingUserManufacturers = (await q`
      select * from pricing_user_manufacturers order by user_id, manufacturer_id
    `) as Array<Record<string, unknown>>;
    const pricingProjects = (await q`
      select * from pricing_projects order by id
    `) as Array<Record<string, unknown>>;
    const pricingProjectConstants = (await q`
      select * from pricing_project_constants order by pricing_project_id
    `) as Array<Record<string, unknown>>;
    const pricingProductLines = (await q`
      select * from pricing_product_lines order by id
    `) as Array<Record<string, unknown>>;

    // Files: anything attached to a lead's project, plus every quotation-kind
    // file owned by a presales user (old Excel / PDF priced quotes).
    const files = (await q`
      select id, project_id, owner_id, kind, filename, mime, size_bytes,
             storage_path, created_at
      from project_files
      where deleted_at is null
        and (project_id = any(${leadProjectIds}::int[])
             or (kind = 'quotation' and owner_id = any(${presalesUserIds}::int[])))
      order by kind, id
    `) as Array<{
      id: number;
      project_id: number;
      owner_id: number | null;
      kind: string;
      filename: string;
      mime: string;
      size_bytes: number;
      storage_path: string;
      created_at: string;
    }>;

    // ── Build the ZIP ────────────────────────────────────────────────────────
    const generatedAt = new Date().toISOString();
    const zip = new JSZip();

    const dumped: Array<{ name: string; rows: number }> = [];
    const dump = (name: string, rows: Array<Record<string, unknown>>) => {
      zip.file(`data/${name}.json`, JSON.stringify(rows, jsonReplacer, 2));
      zip.file(`data/${name}.csv`, toCsv(rows));
      dumped.push({ name, rows: rows.length });
    };

    dump("leads", leads);
    dump("quotations", quotations);
    dump("quotation_stock_checks", stockChecks);
    dump("pricing_manufacturers", pricingManufacturers);
    dump("pricing_user_manufacturers", pricingUserManufacturers);
    dump("pricing_projects", pricingProjects);
    dump("pricing_project_constants", pricingProjectConstants);
    dump("pricing_product_lines", pricingProductLines);
    dump(
      "presales_users",
      presalesUserRows as unknown as Array<Record<string, unknown>>,
    );

    // ── Embed the real file bytes (original format) ──────────────────────────
    const fileManifest: Array<{
      id: number;
      kind: string;
      project_id: number;
      owner_id: number | null;
      filename: string;
      zip_path: string | null;
      bytes: number | null;
      sha256: string | null;
      embedded: boolean;
      source?: "r2" | "supabase";
      error?: string;
    }> = [];

    const r2 = isR2Configured();
    for (const f of files) {
      const safe = safeFilename(f.filename) || `file-${f.id}`;
      const zipPath = `files/${f.kind || "other"}/${f.id}-${safe}`;
      let bytes: Uint8Array | null = null;
      let source: "r2" | "supabase" | undefined;
      let error: string | undefined;
      try {
        if (r2) {
          bytes = await fetchR2BytesForPath(f.storage_path);
          if (bytes) source = "r2";
        }
        if (!bytes) {
          bytes = await downloadStorageObject(
            PROJECT_FILES_BUCKET,
            f.storage_path,
          );
          if (bytes) source = "supabase";
        }
      } catch (e) {
        error = (e as Error).message;
      }
      if (bytes) {
        zip.file(zipPath, bytes);
        fileManifest.push({
          id: f.id,
          kind: f.kind,
          project_id: f.project_id,
          owner_id: f.owner_id,
          filename: f.filename,
          zip_path: zipPath,
          bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          embedded: true,
          source,
        });
      } else {
        fileManifest.push({
          id: f.id,
          kind: f.kind,
          project_id: f.project_id,
          owner_id: f.owner_id,
          filename: f.filename,
          zip_path: null,
          bytes: f.size_bytes ?? null,
          sha256: null,
          embedded: false,
          error: error || "not found in Cloudflare R2 or Supabase Storage",
        });
      }
    }
    zip.file("files/_manifest.json", JSON.stringify(fileManifest, null, 2));

    const embedded = fileManifest.filter((m) => m.embedded).length;
    const totalBytes = fileManifest
      .filter((m) => m.embedded && m.bytes)
      .reduce((a, b) => a + (b.bytes ?? 0), 0);

    const manifest = {
      kind: "presales-backup",
      generatedAt,
      presalesUsers: presalesUserRows.length,
      tables: dumped,
      files: {
        total: fileManifest.length,
        embedded,
        failed: fileManifest.length - embedded,
        bytes: totalBytes,
      },
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    zip.file(
      "README.txt",
      [
        "MagicTech — Presales Backup",
        "===========================",
        `Generated: ${generatedAt}`,
        "",
        "This is a one-click snapshot of everything in the Presales workspace,",
        "with every uploaded file kept in its ORIGINAL format (the exact PDF,",
        "Excel, DWG, … bytes as uploaded — nothing re-rendered).",
        "",
        "Contents",
        "--------",
        "  data/leads.{json,csv}                  every lead (the presales queue)",
        "  data/quotations.{json,csv}             presales / lead-linked quotations",
        "                                         (items, totals & config included)",
        "  data/quotation_stock_checks.{json,csv} stock checks on those quotations",
        "  data/pricing_*.{json,csv}              the per-manufacturer pricing sheets",
        "  data/presales_users.{json,csv}         id → username lookup for owner_id",
        "  files/<kind>/<id>-<name>               the actual uploaded files, as-is",
        "  files/_manifest.json                   path / size / sha256 / source",
        "  manifest.json                          summary of this backup",
        "",
        "Files",
        "-----",
        `  Embedded: ${embedded} file(s), ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`,
        `  Failed:   ${fileManifest.length - embedded} file(s)` +
          (fileManifest.length - embedded
            ? " (see files/_manifest.json for why)"
            : ""),
        "",
        "The data/*.json files map back to the live database by primary key;",
        "the owner_id / assigned_to_id columns resolve via data/presales_users.csv.",
      ].join("\n"),
    );

    const bytes = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const stamp = generatedAt
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .replace("Z", "Z");
    const filename = `presales-backup-${stamp}.zip`;

    const body = new Blob([new Uint8Array(bytes)], { type: "application/zip" });
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status =
      msg === "FORBIDDEN" ? 403 : msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function jsonReplacer(_k: string, v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return `\\x${Buffer.from(v).toString("hex")}`;
  return v;
}

/** RFC-4180 CSV from an array of row objects (column union, sorted stable). */
function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") {
      if (v instanceof Date) return v.toISOString();
      if (v instanceof Uint8Array)
        return `\\x${Buffer.from(v).toString("hex")}`;
      return JSON.stringify(v);
    }
    const s = String(v);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => escape(r[c])).join(","));
  return lines.join("\r\n");
}
