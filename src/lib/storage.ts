/**
 * Pure helpers for project files (PDFs, spreadsheets, BOQs, CAD).
 *
 * Storage itself lives in Cloudflare R2 — uploads PUT to a presigned R2 URL,
 * reads/downloads GET from a presigned R2 URL, and deletes remove the R2
 * object (see src/lib/file-backup.ts and src/lib/r2.ts). This module holds only
 * the provider-agnostic bits: the per-MIME size caps, filename sanitisation,
 * and the canonical storage-path layout. There is no Supabase dependency here.
 *
 * Per-file caps
 * ─────────────
 *   - PDF  ........... 25 MB
 *   - Spreadsheet .... 25 MB  (xlsx / xls / csv / ods)
 *   - Image  ......... 15 MB  (photos, BOQ scans, site shots)
 *   - Video  ......... 200 MB (site walkthroughs, progress clips)
 *   - CAD  ........... 50 MB  (dwg / dxf)
 *   - Other  ......... 50 MB  (zip, archives, miscellaneous media)
 *
 * The cap is enforced server-side in the sign-upload endpoint AND
 * client-side before the file picker submits, so the user sees a
 * readable error before round-tripping a refused payload.
 */

/** Logical name for the project-files store (the R2 key prefix). */
export const PROJECT_FILES_BUCKET = "project-files";

/** Per-MIME-class size caps — see the module-level comment for context. */
export const FILE_SIZE_CAPS = {
  pdf: 25 * 1024 * 1024,
  spreadsheet: 25 * 1024 * 1024,
  image: 15 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  cad: 50 * 1024 * 1024,
  other: 50 * 1024 * 1024,
} as const;

export type FileKind = "quotation" | "po" | "boq" | "other";
const ALLOWED_KINDS: ReadonlySet<FileKind> = new Set([
  "quotation",
  "po",
  "boq",
  "other",
]);

export function normalizeFileKind(raw: unknown): FileKind {
  if (typeof raw === "string" && ALLOWED_KINDS.has(raw as FileKind)) {
    return raw as FileKind;
  }
  return "other";
}

export function maxBytesForMime(mime: string, filename?: string): number {
  const m = (mime || "").toLowerCase();
  // CAD formats: browsers usually send application/octet-stream for .dwg
  // and .dxf, so fall back to the extension. Doing this first means a
  // .dwg with no MIME doesn't get capped at the smaller "other" bucket
  // on the way through the legacy image/spreadsheet branches.
  const ext = (filename || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (
    ext === "dwg" ||
    ext === "dxf" ||
    m === "application/acad" ||
    m === "image/vnd.dwg" ||
    m === "image/x-dwg"
  ) {
    return FILE_SIZE_CAPS.cad;
  }
  if (m === "application/pdf") return FILE_SIZE_CAPS.pdf;
  if (m.startsWith("image/")) return FILE_SIZE_CAPS.image;
  if (m.startsWith("video/")) return FILE_SIZE_CAPS.video;
  if (
    m === "application/vnd.ms-excel" ||
    m ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    m === "application/vnd.oasis.opendocument.spreadsheet" ||
    m === "text/csv"
  ) {
    return FILE_SIZE_CAPS.spreadsheet;
  }
  return FILE_SIZE_CAPS.other;
}

/**
 * Sanitise an arbitrary user-supplied filename into something safe to use
 * as a storage object key. Non-ASCII characters (e.g. Arabic) and many
 * symbols are collapsed to "_". The extension is preserved (lower-cased,
 * alnum-only) so MIME guessing and downloads stay consistent. The
 * human-readable name is kept separately in project_files.filename for
 * display, so flattening the key here is lossless to the user. Empty /
 * pathological input falls back to "file".
 */
export function safeFilename(raw: string): string {
  const input = String(raw || "");
  const dot = input.lastIndexOf(".");
  const hasExt = dot > 0 && dot < input.length - 1;
  const ext = hasExt
    ? input.slice(dot + 1).replace(/[^A-Za-z0-9]/g, "").slice(0, 16).toLowerCase()
    : "";
  const base = (hasExt ? input.slice(0, dot) : input)
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+/, "")
    .slice(0, 180);
  const name = base || "file";
  return ext ? `${name}.${ext}` : name;
}

/**
 * Object key under the project-files store. Layout:
 *   <ownerId>/<projectId>/<random>-<safe-filename>
 * The owner prefix gives a clean per-user namespace, and including the
 * project id makes deletion of an entire project's files a single prefix
 * delete.
 */
export function buildStoragePath(opts: {
  ownerId: number;
  projectId: number;
  filename: string;
}): string {
  const safe = safeFilename(opts.filename);
  // Random suffix de-duplicates filenames within the same project. 8
  // hex chars is enough collision resistance for human-scale uploads.
  const rand = Math.random().toString(16).slice(2, 10);
  return `${opts.ownerId}/${opts.projectId}/${rand}-${safe}`;
}
