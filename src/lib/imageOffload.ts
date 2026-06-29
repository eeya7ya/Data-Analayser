/**
 * Quotation / catalogue image offload to Cloudflare R2.
 *
 * Item pictures (`items_json[].picture_url`) and product thumbnails
 * (`products.picture_url`) are stored as base64 `data:image/...` URLs, which
 * means the image bytes live inside the Neon database and grow it as
 * quotations are created. This module moves those bytes into R2 (where files
 * already live) and replaces the data URL with a small in-app link
 * (`/api/quote-img/<hash>.<ext>`), keeping the database row lean.
 *
 * Safety properties:
 *   - OFF by default. Only active when OFFLOAD_QUOTATION_IMAGES=1 and R2 is
 *     configured — so deploying this changes nothing until it's switched on
 *     (after verifying the serving route on a preview).
 *   - Backward compatible. Old rows keep their inline base64 and still render;
 *     only newly-saved images are offloaded. No migration, no read-path change
 *     (an <img src> renders a URL exactly as it rendered a data URL).
 *   - Fail-safe per image. If an upload errors, the original base64 is kept so
 *     a save never breaks because of offload.
 *   - Deduplicated by content hash — the same product photo reused across many
 *     quotations is stored once in R2.
 */
import { createHash } from "node:crypto";
import { r2PutObject, r2HeadObject, isR2Configured } from "./r2";

const IMG_PREFIX = "quote-img";
const DATA_IMG_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/;

/**
 * Whether image offload is switched on for this deployment. OFF unless
 * OFFLOAD_QUOTATION_IMAGES=1 AND R2 is configured.
 */
export function imageOffloadEnabled(): boolean {
  return process.env.OFFLOAD_QUOTATION_IMAGES === "1" && isR2Configured();
}

function extFor(mime: string): string {
  const sub = (mime.split("/")[1] || "bin").toLowerCase();
  if (sub === "jpeg") return "jpg";
  if (sub === "svg+xml") return "svg";
  return sub.replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
}

/**
 * Upload one base64 data URL to R2 (deduped by content hash) and return the
 * small in-app URL that serves it. Throws on R2 failure — the caller catches
 * and keeps the original data URL.
 */
async function offloadOneDataUrl(dataUrl: string): Promise<string> {
  const m = DATA_IMG_RE.exec(dataUrl.trim());
  if (!m) return dataUrl;
  const mime = m[1];
  const buf = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
  if (buf.length === 0) return dataUrl;

  const hash = createHash("sha256").update(buf).digest("hex");
  const name = `${hash}.${extFor(mime)}`;
  const key = `${IMG_PREFIX}/${name}`;

  let present = false;
  try {
    present = (await r2HeadObject(key)).exists;
  } catch {
    present = false;
  }
  if (!present) await r2PutObject(key, buf, mime);

  // Stable, non-expiring in-app URL; the serving route presigns R2 per request.
  return `/api/${IMG_PREFIX}/${name}`;
}

/**
 * Recursively replace every embedded base64 image inside `value` with an R2
 * link. No-op (returns the input unchanged) when offload is disabled. Each
 * image is fail-safe: if its upload errors, the original base64 is kept.
 */
export async function offloadImages<T>(value: T): Promise<T> {
  if (!imageOffloadEnabled()) return value;
  return (await walk(value)) as T;
}

async function walk(v: unknown): Promise<unknown> {
  if (typeof v === "string") {
    if (v.startsWith("data:image/")) {
      try {
        return await offloadOneDataUrl(v);
      } catch {
        return v; // fail-safe: keep inline base64
      }
    }
    return v;
  }
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (const item of v) out.push(await walk(item));
    return out;
  }
  if (v && typeof v === "object") {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src)) out[k] = await walk(src[k]);
    return out;
  }
  return v;
}
