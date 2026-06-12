import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PROJECT_FILES_BUCKET } from "@/lib/storage";
import {
  isR2Configured,
  mirrorStorageObjectToR2,
  type MirrorResult,
} from "@/lib/file-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET  /api/admin/backup-files-r2  → dry-run preview
 * POST /api/admin/backup-files-r2  → mirror every file into Cloudflare R2
 *
 * Project files normally live only in Supabase Storage (the browser uploads
 * straight there). This endpoint copies every object in the `project-files`
 * bucket into the configured Cloudflare R2 bucket so R2 holds a durable
 * second copy.
 *
 * New uploads are mirrored automatically (see src/app/api/project-files), so
 * in steady state this sweep mostly confirms everything is already backed up
 * and copies any stragglers — e.g. large files whose inline mirror was
 * interrupted, or everything that predates the auto-mirror.
 *
 * The copy is idempotent: objects already present in R2 with a matching size
 * are skipped, so it's safe to run repeatedly (and to re-run if it doesn't
 * finish the whole bucket within one invocation's time budget).
 *
 * Admin only.
 */

type StorageObjectRow = {
  name: string;
  size_bytes: number | null;
  mimetype: string | null;
};

/**
 * List every real object in the project-files bucket. We read
 * storage.objects directly (rather than the JS SDK's paginated list) and
 * skip Supabase's synthetic `.emptyFolderPlaceholder` rows, which carry no
 * useful bytes.
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
  // `metadata->>'size'` is text, and the postgres driver returns ::bigint as a
  // string too. Coerce to a real number here once, so the byte total sums
  // numerically (string `+` would concatenate and overflow to Infinity) and
  // the R2 skip check compares number-to-number rather than number-to-string.
  return rows.map((r) => {
    const n = r.size_text == null ? NaN : Number(r.size_text);
    return {
      name: r.name,
      size_bytes: Number.isFinite(n) ? n : null,
      mimetype: r.mimetype,
    };
  });
}

export async function GET() {
  try {
    await requireAdmin();
    await ensureSchema();
    const q = sql();
    const objects = await listProjectFileObjects(q);
    const totalBytes = objects.reduce((a, o) => a + (o.size_bytes ?? 0), 0);
    return NextResponse.json({
      configured: isR2Configured(),
      bucket: PROJECT_FILES_BUCKET,
      totalFiles: objects.length,
      totalBytes,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST() {
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
    const objects = await listProjectFileObjects(q);

    // Time-box the sweep so we always respond *before* the function's
    // wall-clock limit. If we let it run over, Vercel kills the request and
    // the browser gets a 504 with an HTML body — which is exactly the
    // "Unexpected token 'A'… is not valid JSON" failure this replaces.
    //
    // We stop *starting* new files once past the deadline and report
    // `done: false` so the client calls again. The copy is idempotent, so the
    // next call skips everything already in R2 (a cheap HEAD) and resumes
    // where this one left off. Sequential keeps peak memory at a single file
    // (videos can be up to 200 MB).
    const DEADLINE_MS = 40_000;
    const startedAt = Date.now();

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
    return NextResponse.json({
      ok: true,
      total: objects.length,
      processed: results.length,
      // True once every object was attempted in this single call — i.e. the
      // whole bucket is reconciled and the client can stop looping.
      done: !stoppedEarly,
      mirrored: mirrored.length,
      skipped: results.filter((r) => r.outcome === "skipped").length,
      missing: results.filter((r) => r.outcome === "missing").length,
      failed: results.filter((r) => r.outcome === "error").length,
      bytesMirrored: mirrored.reduce((a, r) => a + (r.bytes ?? 0), 0),
      // Cap the error list so a bucket-wide misconfiguration can't return a
      // multi-megabyte JSON body; the counts above still reflect everything.
      errors: results
        .filter((r) => r.outcome === "error")
        .slice(0, 50)
        .map((r) => ({ path: r.storagePath, error: r.error })),
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
