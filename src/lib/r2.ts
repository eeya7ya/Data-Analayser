/**
 * Cloudflare R2 client using the S3-compatible REST API with AWS Sigv4 auth.
 *
 * Used by the migration route to offload oversized columns (>1MB) that can't
 * fit in D1 cells. The full original blob is uploaded to R2 and a small
 * reference is stored in D1 in place of the original value.
 *
 * Required env vars:
 *   CLOUDFLARE_ACCOUNT_ID            — already used by db-d1.ts
 *   CLOUDFLARE_R2_ACCESS_KEY_ID      — from dashboard → R2 → Manage API tokens
 *   CLOUDFLARE_R2_SECRET_ACCESS_KEY  — paired secret
 *   CLOUDFLARE_R2_BUCKET             — defaults to "magictech-files"
 */

import { createHash, createHmac } from "node:crypto";

const SERVICE = "s3";
const REGION = "auto";

function readR2Config(): {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
} {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucket = process.env.CLOUDFLARE_R2_BUCKET || "magictech-files";
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 is not configured. Set CLOUDFLARE_ACCOUNT_ID, " +
        "CLOUDFLARE_R2_ACCESS_KEY_ID and CLOUDFLARE_R2_SECRET_ACCESS_KEY in " +
        "Vercel Project Settings → Environment Variables.",
    );
  }
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export function isR2Configured(): boolean {
  return Boolean(
    process.env.CLOUDFLARE_ACCOUNT_ID &&
      process.env.CLOUDFLARE_R2_ACCESS_KEY_ID &&
      process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  );
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function deriveSigningKey(secret: string, dateStamp: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

/**
 * RFC 3986 / AWS SigV4 URI encoding. Percent-encodes every byte except the
 * unreserved set (A-Z a-z 0-9 - _ . ~).
 *
 * This exists because `encodeURIComponent` leaves `! ' ( ) *` unescaped, but
 * AWS/R2 require them encoded. A key containing e.g. an apostrophe would then
 * produce a canonical request that doesn't match the one R2 recomputes on its
 * side, and the request is rejected with 403 SignatureDoesNotMatch. Both the
 * URL we fetch and the canonical path we sign must use this same encoding so
 * they agree byte-for-byte.
 *
 * `encodeSlash = false` leaves "/" intact so object keys keep their path
 * separators while each segment is still fully encoded.
 */
function awsUriEncode(input: string, encodeSlash = true): string {
  const bytes = Buffer.from(input, "utf8");
  let out = "";
  for (const b of bytes) {
    if (
      (b >= 0x41 && b <= 0x5a) || // A-Z
      (b >= 0x61 && b <= 0x7a) || // a-z
      (b >= 0x30 && b <= 0x39) || // 0-9
      b === 0x2d || // -
      b === 0x5f || // _
      b === 0x2e || // .
      b === 0x7e // ~
    ) {
      out += String.fromCharCode(b);
    } else if (b === 0x2f && !encodeSlash) {
      out += "/";
    } else {
      out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

/**
 * PUT a single object to R2. The key may contain slashes for folder-like
 * organization. Returns the bucket and key so callers can build a reference
 * to store elsewhere (e.g. in a D1 cell).
 */
export async function r2PutObject(
  key: string,
  body: Buffer | string,
  contentType = "application/octet-stream",
): Promise<{ bucket: string; key: string; size: number }> {
  const { accountId, accessKeyId, secretAccessKey, bucket } = readR2Config();
  const bodyBuf = typeof body === "string" ? Buffer.from(body, "utf-8") : body;
  // Copy into a freshly-allocated Uint8Array so the underlying buffer is a
  // strict ArrayBuffer (not the ArrayBufferLike union). Strict TS lib types
  // reject Buffer<ArrayBufferLike> as a BodyInit/BlobPart.
  const bodyBytes = new Uint8Array(bodyBuf.length);
  bodyBytes.set(bodyBuf);
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const encodedKey = awsUriEncode(key, false);
  const url = `https://${host}/${bucket}/${encodedKey}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(bodyBuf);

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    `/${bucket}/${encodedKey}`,
    "", // query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = deriveSigningKey(secretAccessKey, dateStamp);
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Host: host,
      "X-Amz-Date": amzDate,
      "X-Amz-Content-Sha256": payloadHash,
      Authorization: authorization,
      "Content-Type": contentType,
      "Content-Length": String(bodyBuf.length),
    },
    body: bodyBytes,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2 PUT ${res.status}: ${text.slice(0, 400)}`);
  }
  return { bucket, key, size: bodyBuf.length };
}

/**
 * Standard reference shape stored in D1 in place of an oversized value.
 * The app can detect this via the `__r2_overflow__` marker and lazy-fetch
 * the real value from R2.
 */
export type R2Overflow = {
  __r2_overflow__: true;
  bucket: string;
  key: string;
  column: string;
  original_size_bytes: number;
  content_type: string;
};

/**
 * GET a single object from R2 and return its body as a UTF-8 string. Used
 * to resolve `__r2_overflow__` references stored in D1.
 */
export async function r2GetObject(key: string): Promise<string> {
  const { accountId, accessKeyId, secretAccessKey, bucket } = readR2Config();
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const encodedKey = awsUriEncode(key, false);
  const url = `https://${host}/${bucket}/${encodedKey}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(""); // empty body for GET

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "GET",
    `/${bucket}/${encodedKey}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = deriveSigningKey(secretAccessKey, dateStamp);
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Host: host,
      "X-Amz-Date": amzDate,
      "X-Amz-Content-Sha256": payloadHash,
      Authorization: authorization,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2 GET ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.text();
}

/**
 * HEAD a single object in R2. Returns whether it exists and its size in
 * bytes (from Content-Length). The file-backup mirror uses this to skip
 * objects already present in R2 with a matching size, so re-running a
 * backup is cheap and idempotent — no needless Supabase egress or R2 PUTs.
 */
export async function r2HeadObject(
  key: string,
): Promise<{ exists: boolean; size: number | null }> {
  const { accountId, accessKeyId, secretAccessKey, bucket } = readR2Config();
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const encodedKey = awsUriEncode(key, false);
  const url = `https://${host}/${bucket}/${encodedKey}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(""); // empty body for HEAD

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "HEAD",
    `/${bucket}/${encodedKey}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = deriveSigningKey(secretAccessKey, dateStamp);
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method: "HEAD",
    headers: {
      Host: host,
      "X-Amz-Date": amzDate,
      "X-Amz-Content-Sha256": payloadHash,
      Authorization: authorization,
    },
  });

  if (res.status === 404) return { exists: false, size: null };
  if (!res.ok) {
    throw new Error(`R2 HEAD ${res.status}`);
  }
  const len = res.headers.get("content-length");
  return { exists: true, size: len ? Number(len) : null };
}

/**
 * Build a SigV4 query-string presigned URL for R2 that a browser can hit
 * directly — `PUT` to upload a file's bytes, `GET` to download/view them —
 * without our server ever touching the payload (the whole point: files can be
 * up to 200 MB, far past Vercel's request-body limit).
 *
 * Only the `host` header is signed, so the browser is free to add its own
 * headers (e.g. Content-Type on upload) without invalidating the signature.
 * The payload is `UNSIGNED-PAYLOAD`, as required for query presigning.
 *
 * `responseContentDisposition` (GET only) sets S3's `response-content-
 * disposition` override so an explicit download saves with a friendly
 * filename; omit it for inline viewing.
 *
 * NOTE: browser PUT/GET to *.r2.cloudflarestorage.com is cross-origin, so the
 * R2 bucket needs a CORS policy allowing the app origin + PUT/GET/HEAD.
 */
export function r2PresignUrl(
  method: "GET" | "PUT",
  key: string,
  opts?: { expiresSeconds?: number; responseContentDisposition?: string },
): string {
  const { accountId, accessKeyId, secretAccessKey, bucket } = readR2Config();
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const encodedKey = awsUriEncode(key, false);
  const canonicalUri = `/${bucket}/${encodedKey}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  // R2/S3 cap presigned URLs at 7 days.
  const expires = Math.min(Math.max(1, Math.trunc(opts?.expiresSeconds ?? 300)), 604800);

  const params: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${accessKeyId}/${credentialScope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  if (opts?.responseContentDisposition) {
    params.push(["response-content-disposition", opts.responseContentDisposition]);
  }
  // Canonical query string: every key/value AWS-URI-encoded (so the "/" in the
  // credential scope becomes %2F), then sorted by encoded key.
  const canonicalQuery = params
    .map(([k, v]) => [awsUriEncode(k), awsUriEncode(v)] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = deriveSigningKey(secretAccessKey, dateStamp);
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * DELETE a single object from R2 (server-side, SigV4 header auth). Treats a
 * missing key as success — S3/R2 return 204 either way — so deleting a file
 * whose blob is already gone doesn't error.
 */
export async function r2DeleteObject(key: string): Promise<void> {
  const { accountId, accessKeyId, secretAccessKey, bucket } = readR2Config();
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const encodedKey = awsUriEncode(key, false);
  const url = `https://${host}/${bucket}/${encodedKey}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(""); // empty body

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "DELETE",
    `/${bucket}/${encodedKey}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = deriveSigningKey(secretAccessKey, dateStamp);
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Host: host,
      "X-Amz-Date": amzDate,
      "X-Amz-Content-Sha256": payloadHash,
      Authorization: authorization,
    },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`R2 DELETE ${res.status}: ${text.slice(0, 200)}`);
  }
}

/**
 * Type guard: true when the value is a parsed R2 overflow reference.
 */
export function isR2OverflowRef(value: unknown): value is R2Overflow {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __r2_overflow__?: unknown }).__r2_overflow__ === true
  );
}

/**
 * If `value` is (or stringifies to) an R2 overflow reference, fetch the
 * original payload from R2 and return it parsed as JSON. Otherwise return
 * the value unchanged. Use this when reading JSON columns from D1 that
 * may have been offloaded during migration.
 *
 * Accepts:
 *   - a parsed object containing { __r2_overflow__: true, ... }
 *   - a JSON-string of the above (D1 stores it as text)
 *   - anything else (passes through unchanged)
 */
export async function resolveR2Overflow(value: unknown): Promise<unknown> {
  let ref: unknown = value;
  if (typeof value === "string" && value.includes('"__r2_overflow__"')) {
    try {
      ref = JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (!isR2OverflowRef(ref)) return value;
  const body = await r2GetObject(ref.key);
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/**
 * Resolve every R2 overflow marker inside a row set in one batched pass.
 * Operates on the result of a D1 query: each row is an object whose JSON
 * columns are stored as text. If a column's text starts with the overflow
 * marker, this fetches the real payload from R2 and replaces the column
 * with the parsed JSON.
 *
 * - `columns` optionally restricts which columns to scan; otherwise every
 *   string column is checked (cheap — substring match before JSON.parse).
 * - R2 keys are deduplicated and fetched in parallel, so an N-row result
 *   set with K distinct overflow refs costs K round-trips, not K*N.
 * - On R2 failure the original marker string is kept and the error is
 *   re-thrown so the caller decides (fail the request vs. fall back).
 *
 * Returns a new array; input rows are not mutated.
 */
export async function resolveR2OverflowsInRows<
  T extends Record<string, unknown>,
>(rows: T[], columns?: readonly string[]): Promise<T[]> {
  if (rows.length === 0) return rows;

  // Collect every (row index, column, parsed marker) tuple, then dedupe by key.
  const toResolve: Array<{ rowIdx: number; col: string; ref: R2Overflow }> = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cols = columns ?? Object.keys(row);
    for (const col of cols) {
      const v = row[col];
      if (typeof v !== "string" || !v.includes('"__r2_overflow__"')) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(v);
      } catch {
        continue;
      }
      if (isR2OverflowRef(parsed)) {
        toResolve.push({ rowIdx: i, col, ref: parsed });
      }
    }
  }
  if (toResolve.length === 0) return rows;

  // One fetch per unique R2 key.
  const uniqueKeys = Array.from(new Set(toResolve.map((t) => t.ref.key)));
  const fetched = new Map<string, unknown>();
  await Promise.all(
    uniqueKeys.map(async (key) => {
      const body = await r2GetObject(key);
      try {
        fetched.set(key, JSON.parse(body));
      } catch {
        fetched.set(key, body);
      }
    }),
  );

  // Build a new row array with the resolved values substituted in.
  const out = rows.map((r) => ({ ...r })) as T[];
  for (const { rowIdx, col, ref } of toResolve) {
    (out[rowIdx] as Record<string, unknown>)[col] = fetched.get(ref.key);
  }
  return out;
}
