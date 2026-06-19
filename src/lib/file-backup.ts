/**
 * Mirror project files from Supabase Storage into Cloudflare R2.
 *
 * Why this exists
 * ───────────────
 * Uploads land directly in Supabase Storage: the browser PUTs each file to
 * a signed URL (see src/lib/storage.ts), so the bytes never transit our
 * server on the way in. That leaves the only copy of every BOQ / PO / PDF
 * in Supabase. This module gives those bytes a durable second home in the
 * Cloudflare R2 bucket that's already configured for the app.
 *
 * Each Supabase object is copied to R2 under a stable
 * `project-files/<storage_path>` key, so the R2 layout mirrors Supabase
 * 1:1 and matches the `r2/upload-to-r2.sh` convention emitted by the full
 * system backup.
 *
 * Two callers share the same copy primitive:
 *   - the upload path (src/app/api/project-files) mirrors each new file
 *     just after it's registered — best-effort, after the response is sent,
 *     so it never slows the user down; and
 *   - the admin "Back up files to R2" sweep (src/app/api/admin/
 *     backup-files-r2) walks every existing object so the whole bucket
 *     lands in R2 in one click.
 *
 * The copy is idempotent: an object already in R2 with a matching byte size
 * is skipped, so re-running is cheap and safe.
 */

import { PROJECT_FILES_BUCKET, downloadStorageObject } from "./storage";
import {
  isR2Configured,
  r2DeleteObject,
  r2HeadObject,
  r2PresignUrl,
  r2PutObject,
} from "./r2";

/**
 * R2 key prefix under which Supabase Storage objects are mirrored. Keeps
 * file backups namespaced away from the D1 migration `overflow/...` keys
 * that share the same bucket.
 */
export const R2_BACKUP_PREFIX = "project-files";

/** Derive the R2 object key for a Supabase `project-files` storage path. */
export function r2KeyForStoragePath(storagePath: string): string {
  return `${R2_BACKUP_PREFIX}/${storagePath}`;
}

/**
 * Presign an R2 PUT URL the browser uploads a new file's bytes to directly.
 * The object lands at the same `project-files/<storage_path>` key the rest of
 * the app reads from, so uploads and the legacy backup share one layout.
 */
export function r2PresignUploadUrl(
  storagePath: string,
  expiresSeconds = 300,
): string {
  return r2PresignUrl("PUT", r2KeyForStoragePath(storagePath), {
    expiresSeconds,
  });
}

/**
 * Presign a short-lived R2 GET URL for viewing or downloading a stored file.
 * Pass `downloadFilename` to force an attachment download with that name
 * (RFC 5987 encoded so quotes / non-ASCII are safe); omit it for inline view.
 */
export function r2PresignDownloadUrl(
  storagePath: string,
  opts?: { expiresSeconds?: number; downloadFilename?: string },
): string {
  return r2PresignUrl("GET", r2KeyForStoragePath(storagePath), {
    expiresSeconds: opts?.expiresSeconds ?? 300,
    responseContentDisposition: opts?.downloadFilename
      ? `attachment; filename*=UTF-8''${encodeURIComponent(opts.downloadFilename)}`
      : undefined,
  });
}

/** True when the file's bytes are present in R2 (used to decide R2 vs the
 * Supabase read-fallback). */
export async function r2ObjectExistsForPath(
  storagePath: string,
): Promise<boolean> {
  const head = await r2HeadObject(r2KeyForStoragePath(storagePath));
  return head.exists;
}

/** Delete a file's object from R2. Missing keys are treated as success. */
export async function deleteR2ObjectForPath(
  storagePath: string,
): Promise<void> {
  await r2DeleteObject(r2KeyForStoragePath(storagePath));
}

/**
 * Fetch a stored file's raw bytes from R2. Returns null when the object is
 * absent (or R2 isn't configured), so callers can fall back to another source.
 * Uses a short-lived presigned GET so binary payloads (PDFs, images, CAD)
 * round-trip safely — unlike r2GetObject(), which decodes the body as UTF-8.
 * Used by the full system backup to embed files that live only in R2.
 */
export async function fetchR2BytesForPath(
  storagePath: string,
): Promise<Buffer | null> {
  if (!isR2Configured()) return null;
  const url = r2PresignDownloadUrl(storagePath, { expiresSeconds: 300 });
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`R2 GET ${res.status} for ${storagePath}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export type MirrorOutcome = "mirrored" | "skipped" | "missing" | "error";

export type MirrorResult = {
  storagePath: string;
  key: string;
  outcome: MirrorOutcome;
  /** Bytes copied (mirrored) or the size of the existing R2 object (skipped). */
  bytes?: number;
  error?: string;
};

/**
 * Copy one Supabase Storage object into R2. Returns a structured outcome
 * instead of throwing so callers — the bulk sweep and the fire-and-forget
 * upload hook — can aggregate results without a try/catch at every call
 * site.
 *
 *   - "skipped"  → already in R2 with the same size (unless `force`)
 *   - "missing"  → the object is no longer in Supabase Storage
 *   - "mirrored" → bytes copied to R2
 *   - "error"    → download or upload failed (message in `error`)
 */
export async function mirrorStorageObjectToR2(
  storagePath: string,
  opts?: {
    contentType?: string;
    /** Size from the DB / storage metadata; used to skip unchanged objects. */
    expectedSize?: number | null;
    /** Re-upload even when an identical-size object already exists in R2. */
    force?: boolean;
  },
): Promise<MirrorResult> {
  const key = r2KeyForStoragePath(storagePath);
  try {
    if (!opts?.force) {
      const head = await r2HeadObject(key);
      if (
        head.exists &&
        (opts?.expectedSize == null ||
          head.size == null ||
          head.size === opts.expectedSize)
      ) {
        return {
          storagePath,
          key,
          outcome: "skipped",
          bytes: head.size ?? undefined,
        };
      }
    }
    const bytes = await downloadStorageObject(PROJECT_FILES_BUCKET, storagePath);
    if (!bytes) {
      return { storagePath, key, outcome: "missing" };
    }
    await r2PutObject(
      key,
      Buffer.from(bytes),
      opts?.contentType || "application/octet-stream",
    );
    return { storagePath, key, outcome: "mirrored", bytes: bytes.byteLength };
  } catch (err) {
    return {
      storagePath,
      key,
      outcome: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Re-export so callers can gate on R2 config without importing two modules. */
export { isR2Configured };
