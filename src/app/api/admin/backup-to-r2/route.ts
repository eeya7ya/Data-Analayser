import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PROJECT_FILES_BUCKET } from "@/lib/storage";
import { buildDbSnapshotZip } from "@/lib/db-snapshot";
import {
  isR2Configured,
  mirrorStorageObjectToR2,
  type MirrorResult,
} from "@/lib/file-backup";
import { r2GetObject, r2PresignUrl, r2PutObject } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET  /api/admin/backup-to-r2  → preview (config, last snapshot, file counts)
 * POST /api/admin/backup-to-r2  → one-click "back up everything to Cloudflare R2"
 *
 * This is THE single backup button. It guarantees that the whole app — every
 * database row AND every uploaded file — has a durable copy in Cloudflare R2,
 * so nothing depends on Supabase as a single point of failure:
 *
 *   1. Database → a complete, restore-ready ZIP of every public-schema table
 *      (manifest.json + data/<table>.json, the exact layout the Restore
 *      endpoint ingests) is uploaded to R2 under
 *      `db-backups/<timestamp>/backup.zip`, and a `db-backups/latest.json`
 *      pointer records the newest one.
 *
 *   2. Files → every object still living only in Supabase Storage (anything
 *      uploaded before the R2 cutover) is mirrored into R2. New uploads
 *      already land in R2 directly, so in steady state this just confirms
 *      everything is present and copies any stragglers.
 *
 * The DB step runs once (first call); the file mirror is time-boxed and may
 * need several passes for large buckets — the client loops with
 * `{ skipDb: true }` until the response reports `done: true`. The whole thing
 * is idempotent: re-running re-snapshots the DB (new timestamp) and skips
 * files already in R2 with a matching size.
 *
 * Admin only. Read-only on Supabase — it never mutates rows or storage there.
 */

const DB_BACKUP_PREFIX = "db-backups";
const LATEST_POINTER_KEY = `${DB_BACKUP_PREFIX}/latest.json`;

type LatestPointer = {
  takenAt: string;
  key: string;
  tableCount: number;
  totalRows: number;
  sizeBytes: number;
};

type StorageObjectRow = {
  name: string;
  size_bytes: number | null;
  mimetype: string | null;
};

/**
 * List every real object in the project-files bucket straight from
 * storage.objects (the JS SDK's list paginates awkwardly), skipping Supabase's
 * synthetic `.emptyFolderPlaceholder` rows.
 */
async function listProjectFileObjects(
  q: ReturnType<typeof sql>,
): Promise<StorageObjectRow[]> {
  const rows = (await q`
    select
      name,
      (metadata->>'size') as size_text,
      (metadata->>'mimetype') as mimetype
    from storage.objects
    where bucket_id = ${PROJECT_FILES_BUCKET}
      and name not like '%.emptyFolderPlaceholder'
    order by name
  `) as Array<{
    name: string;
    size_text: string | null;
    mimetype: string | null;
  }>;
  return rows.map((r) => {
    const n = r.size_text == null ? NaN : Number(r.size_text);
    return {
      name: r.name,
      size_bytes: Number.isFinite(n) ? n : null,
      mimetype: r.mimetype,
    };
  });
}

/** Read the latest-snapshot pointer from R2 (null if none / unreadable). */
async function readLatestPointer(): Promise<LatestPointer | null> {
  try {
    const body = await r2GetObject(LATEST_POINTER_KEY);
    return JSON.parse(body) as LatestPointer;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    await requireAdmin();
    await ensureSchema();
    const q = sql();
    const configured = isR2Configured();
    const objects = await listProjectFileObjects(q);
    const totalBytes = objects.reduce((a, o) => a + (o.size_bytes ?? 0), 0);

    const latest = configured ? await readLatestPointer() : null;
    // Mint a short-lived download URL for the most recent DB snapshot so an
    // admin can pull the restore ZIP straight out of R2.
    const latestDownloadUrl =
      configured && latest
        ? r2PresignUrl("GET", latest.key, {
            expiresSeconds: 600,
            responseContentDisposition: `attachment; filename="${latest.key
              .split("/")
              .pop()}"`,
          })
        : null;

    return NextResponse.json({
      configured,
      bucket: process.env.CLOUDFLARE_R2_BUCKET || "magictech-files",
      supabaseFiles: { totalFiles: objects.length, totalBytes },
      lastDbBackup: latest,
      latestDownloadUrl,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    if (!isR2Configured()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Cloudflare R2 is not configured. Set CLOUDFLARE_ACCOUNT_ID, " +
            "CLOUDFLARE_R2_ACCESS_KEY_ID and CLOUDFLARE_R2_SECRET_ACCESS_KEY " +
            "in your environment, then try again.",
        },
        { status: 400 },
      );
    }
    await ensureSchema();
    const q = sql();

    const body = (await req.json().catch(() => ({}))) as { skipDb?: boolean };
    const skipDb = body.skipDb === true;

    // ─── 1. Database → restore-ready ZIP in R2 (first pass only) ─────────────
    let db: {
      done: boolean;
      key: string;
      tableCount: number;
      totalRows: number;
      sizeBytes: number;
      takenAt: string;
    } | null = null;

    if (!skipDb) {
      const { buffer, manifest } = await buildDbSnapshotZip(q);
      const stamp = manifest.generatedAt
        .replace(/[:.]/g, "-")
        .replace("T", "_");
      const key = `${DB_BACKUP_PREFIX}/${stamp}/backup.zip`;
      await r2PutObject(key, buffer, "application/zip");

      const pointer: LatestPointer = {
        takenAt: manifest.generatedAt,
        key,
        tableCount: manifest.tableCount,
        totalRows: manifest.totalRows,
        sizeBytes: buffer.byteLength,
      };
      await r2PutObject(
        LATEST_POINTER_KEY,
        JSON.stringify(pointer, null, 2),
        "application/json",
      );

      db = { done: true, ...pointer };
    }

    // ─── 2. Files → mirror any Supabase-only stragglers into R2 ──────────────
    // Time-boxed so we always answer before Vercel's wall-clock limit. We stop
    // *starting* new files past the deadline and report `filesDone: false`;
    // the client calls again with skipDb:true and the idempotent skip resumes
    // where this left off. Sequential keeps peak memory at one file (videos can
    // be up to 200 MB).
    const DEADLINE_MS = 35_000;
    const startedAt = Date.now();

    const objects = await listProjectFileObjects(q);
    const results: MirrorResult[] = [];
    let stoppedEarly = false;
    for (const obj of objects) {
      if (Date.now() - startedAt > DEADLINE_MS) {
        stoppedEarly = true;
        break;
      }
      results.push(
        await mirrorStorageObjectToR2(obj.name, {
          contentType: obj.mimetype || undefined,
          expectedSize: obj.size_bytes,
        }),
      );
    }

    const mirrored = results.filter((r) => r.outcome === "mirrored");
    const filesDone = !stoppedEarly;

    return NextResponse.json({
      ok: true,
      // The overall operation is finished once the DB snapshot is written (or
      // skipped on a continuation pass) AND every file has been reconciled.
      done: filesDone,
      db,
      files: {
        total: objects.length,
        processed: results.length,
        done: filesDone,
        mirrored: mirrored.length,
        skipped: results.filter((r) => r.outcome === "skipped").length,
        missing: results.filter((r) => r.outcome === "missing").length,
        failed: results.filter((r) => r.outcome === "error").length,
        bytesMirrored: mirrored.reduce((a, r) => a + (r.bytes ?? 0), 0),
        errors: results
          .filter((r) => r.outcome === "error")
          .slice(0, 50)
          .map((r) => ({ path: r.storagePath, error: r.error })),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const status =
    msg === "FORBIDDEN" ? 403 : msg === "UNAUTHENTICATED" ? 401 : 500;
  return NextResponse.json({ ok: false, error: msg }, { status });
}
