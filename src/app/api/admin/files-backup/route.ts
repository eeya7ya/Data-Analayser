import { NextResponse } from "next/server";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fetchR2BytesForPath, isR2Configured } from "@/lib/file-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/admin/files-backup
 *
 * THE files backup. One click downloads every uploaded file — PDFs, DWGs,
 * Excel sheets, photos — in its EXACT original format, laid out in the same
 * Client → Project → Kind folder structure you see in the app:
 *
 *   <Client folder>/<Project>/<Quotations|Purchase Orders|BOQs|Other>/<filename>
 *
 * Unzip the result and every file lands back in a matching folder/sub-folder,
 * so it can be dropped straight onto disk. Read-only on the database.
 *
 * Storage source: Cloudflare R2 ONLY. Uploads land directly in R2 (see
 * src/app/api/project-files/sign-upload), so this never touches Supabase.
 * Files whose bytes can't be found in R2 are listed in `_manifest.json`
 * (embedded:false) rather than silently dropped.
 *
 * Admin only. Exposed from Admin → Backups.
 */
export async function GET() {
  try {
    await requireAdmin();
    await ensureSchema();

    if (!isR2Configured()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "File storage (Cloudflare R2) is not configured on the server. " +
            "Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID and " +
            "CLOUDFLARE_R2_SECRET_ACCESS_KEY.",
        },
        { status: 503 },
      );
    }

    const q = sql();

    // Every live file, with the human-readable folder + project names that
    // define its place in the tree. folder_id is NOT NULL on projects, but we
    // coalesce defensively so a file is never dropped over a missing name.
    const files = (await q`
      select pf.id, pf.kind, pf.filename, pf.mime, pf.size_bytes,
             pf.storage_path, pf.created_at,
             p.id   as project_id,
             coalesce(nullif(p.name, ''), 'Project ' || p.id::text)  as project_name,
             cf.id  as folder_id,
             coalesce(nullif(cf.name, ''), 'Unfiled')                as folder_name
      from project_files pf
      join projects p on p.id = pf.project_id
      left join client_folders cf on cf.id = p.folder_id
      where pf.deleted_at is null and p.deleted_at is null
      order by folder_name, project_name, pf.kind, pf.id
    `) as Array<{
      id: number;
      kind: string;
      filename: string;
      mime: string;
      size_bytes: number;
      storage_path: string;
      created_at: string;
      project_id: number;
      project_name: string;
      folder_id: number | null;
      folder_name: string;
    }>;

    const generatedAt = new Date().toISOString();
    const zip = new JSZip();

    // Track the zip paths already used (case-insensitively) so two files with
    // the same name in the same folder don't overwrite each other inside the
    // archive — the second one gets a " (id)" suffix before its extension.
    const usedPaths = new Set<string>();

    const manifest: Array<{
      id: number;
      folder: string;
      project: string;
      kind: string;
      filename: string;
      zip_path: string | null;
      bytes: number | null;
      sha256: string | null;
      embedded: boolean;
      error?: string;
    }> = [];

    let embedded = 0;
    let totalBytes = 0;

    for (const f of files) {
      const dir = `${safeSegment(f.folder_name)}/${safeSegment(f.project_name)}/${kindFolder(f.kind)}`;
      const zipPath = uniquePath(usedPaths, dir, f.filename, f.id);

      let bytes: Buffer | null = null;
      let error: string | undefined;
      try {
        bytes = await fetchR2BytesForPath(f.storage_path);
      } catch (e) {
        error = (e as Error).message;
      }

      if (bytes) {
        zip.file(zipPath, bytes);
        embedded++;
        totalBytes += bytes.byteLength;
        manifest.push({
          id: f.id,
          folder: f.folder_name,
          project: f.project_name,
          kind: f.kind,
          filename: f.filename,
          zip_path: zipPath,
          bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          embedded: true,
        });
      } else {
        manifest.push({
          id: f.id,
          folder: f.folder_name,
          project: f.project_name,
          kind: f.kind,
          filename: f.filename,
          zip_path: null,
          bytes: f.size_bytes ?? null,
          sha256: null,
          embedded: false,
          error: error || "bytes not found in Cloudflare R2",
        });
      }
    }

    const failed = manifest.length - embedded;

    zip.file("_manifest.json", JSON.stringify(manifest, null, 2));
    zip.file(
      "README.txt",
      [
        "MagicTech — Files Backup",
        "========================",
        `Generated: ${generatedAt}`,
        "",
        "Every uploaded file, in its ORIGINAL format (the exact PDF, DWG, Excel,",
        "image, … bytes as uploaded — nothing re-rendered or converted).",
        "",
        "Layout",
        "------",
        "  <Client folder>/<Project>/<Kind>/<filename>",
        "",
        "  Kind folders: Quotations, Purchase Orders, BOQs, Other — these mirror",
        "  the tabs in each project's Files panel.",
        "",
        "Unzip this archive and the files land in folders/sub-folders that match",
        "the app one-to-one, so you can copy them straight onto disk.",
        "",
        "Source",
        "------",
        "  Files are read directly from Cloudflare R2. Nothing here touches",
        "  Supabase.",
        "",
        "Files",
        "-----",
        `  Included: ${embedded} file(s), ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`,
        `  Missing:  ${failed} file(s)` +
          (failed ? " (see _manifest.json for which and why)" : ""),
        "",
        "_manifest.json lists every file with its folder/project/kind, original",
        "name, size and SHA-256 so the archive can be audited against the app.",
      ].join("\n"),
    );

    const stamp = generatedAt.replace(/[:.]/g, "-");
    const filename = `magictech-files-backup-${stamp}.zip`;

    // Stream the ZIP out instead of buffering it into the response. Vercel
    // serverless functions cap a *buffered* response body at ~4.5 MB — a
    // single real PDF/DWG already blows past that, which drops the connection
    // (the browser sees net::ERR_FAILED). A chunked/streamed response is not
    // subject to that cap, so we hand JSZip's incremental output straight to
    // the client. No Content-Length → the platform sends it chunked.
    const zipStream = zip.generateInternalStream({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
      streamFiles: true,
    });

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        zipStream
          .on("data", (chunk: Uint8Array) => {
            controller.enqueue(chunk);
            // Apply backpressure: if the client is draining slower than JSZip
            // produces, pause so chunks don't pile up in memory.
            if ((controller.desiredSize ?? 1) <= 0) zipStream.pause();
          })
          .on("error", (err: Error) => controller.error(err))
          .on("end", () => controller.close());
      },
      pull() {
        zipStream.resume();
      },
      cancel() {
        zipStream.pause();
      },
    });

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
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

/** Friendly sub-folder name per file kind, mirroring the Files-panel tabs. */
function kindFolder(kind: string): string {
  switch (kind) {
    case "quotation":
      return "Quotations";
    case "po":
      return "Purchase Orders";
    case "boq":
      return "BOQs";
    default:
      return "Other";
  }
}

/**
 * Make a folder / project name safe to use as a single path segment on any OS:
 * strip path separators and the characters Windows forbids, collapse
 * whitespace, and trim leading/trailing dots and spaces (which Windows also
 * rejects). Falls back to a placeholder so a path segment is never empty.
 */
function safeSegment(raw: string): string {
  const cleaned = String(raw || "")
    .replace(/[/\\:*?"<>|]/g, "_") // path separators + Windows-forbidden chars
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120);
  return cleaned || "Unnamed";
}

/**
 * Build a collision-free zip path for a file inside `dir`. The original
 * filename is preserved; on a clash within the same directory the file id is
 * inserted before the extension so nothing is overwritten inside the archive.
 */
function uniquePath(
  used: Set<string>,
  dir: string,
  filename: string,
  id: number,
): string {
  const safeName = safeSegment(filename) || `file-${id}`;
  let candidate = `${dir}/${safeName}`;
  if (used.has(candidate.toLowerCase())) {
    const dot = safeName.lastIndexOf(".");
    const base = dot > 0 ? safeName.slice(0, dot) : safeName;
    const ext = dot > 0 ? safeName.slice(dot) : "";
    candidate = `${dir}/${base} (${id})${ext}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}
