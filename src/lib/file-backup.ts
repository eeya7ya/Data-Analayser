/**
 * Cloudflare R2 helpers for project files (PDFs, BOQs, POs, CAD, …).
 *
 * Why this exists
 * ───────────────
 * R2 is the one and only store for project files. Uploads PUT straight to a
 * presigned R2 URL (see src/app/api/project-files/sign-upload), reads/downloads
 * GET from a presigned R2 URL, and deletes remove the R2 object. This module
 * holds the small primitives that turn a DB `storage_path` into the right R2
 * key and presign the URLs the browser and the admin backups use. There is no
 * Supabase storage dependency anywhere in this flow.
 */

import {
  isR2Configured,
  r2DeleteObject,
  r2HeadObject,
  r2PresignUrl,
} from "./r2";

/**
 * R2 key prefix every project file lives under. Keeps files namespaced away
 * from the D1 migration `overflow/...` keys that share the same bucket.
 */
export const R2_BACKUP_PREFIX = "project-files";

/** Derive the R2 object key for a project file's `storage_path`. */
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

/** Re-export so callers can gate on R2 config without importing two modules. */
export { isR2Configured };
