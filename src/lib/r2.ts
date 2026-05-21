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
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
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
    body: new Blob([bodyBuf], { type: contentType }),
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
