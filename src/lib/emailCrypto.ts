import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Reversible secret encryption for mailbox passwords.
 *
 * Mailbox passwords CANNOT be hashed — we need the plaintext to authenticate to
 * the customer's IMAP/SMTP server — so we use authenticated symmetric
 * encryption (AES-256-GCM) instead:
 *
 *   • Key: 32 bytes from the `EMAIL_ENCRYPTION_KEY` env secret (base64 or hex).
 *     It lives only in the environment — never in the database or the codebase.
 *   • Each value is encrypted with a fresh random 96-bit IV.
 *   • GCM gives confidentiality AND integrity: the 128-bit auth tag is verified
 *     on decrypt, so a tampered ciphertext fails loudly instead of returning
 *     garbage.
 *
 * Stored form is the colon-joined base64 triplet `iv:authTag:ciphertext`.
 * Decryption only ever happens server-side, in-memory, at the moment a
 * connection is opened — the plaintext is never returned to the client.
 */

function getKey(): Buffer {
  const raw = process.env.EMAIL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "EMAIL_ENCRYPTION_KEY is not set — generate one with `openssl rand -base64 32` and add it to the environment.",
    );
  }
  // Accept hex (64 chars) or base64 (typically 44 chars). Either must decode
  // to exactly 32 bytes for AES-256.
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "EMAIL_ENCRYPTION_KEY must decode to 32 bytes (use `openssl rand -base64 32`).",
    );
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Thrown when a stored secret exists but cannot be decrypted with the current
 * `EMAIL_ENCRYPTION_KEY` — almost always because the key was rotated or lost
 * (e.g. moving hosts without carrying the old key across).
 *
 * This is deliberately distinct from "no mailbox configured" and from a normal
 * auth failure: the row is intact, the key simply no longer matches, and the
 * only fix is for the user to re-enter the mailbox password so it gets
 * re-encrypted under the new key. Callers surface that instruction rather than
 * leaking an AES error.
 */
export class SecretUndecryptableError extends Error {
  constructor() {
    super(
      "Saved mailbox password can't be read with the current encryption key — " +
        "it was saved under a previous EMAIL_ENCRYPTION_KEY. Re-enter the " +
        "mailbox password to save it again under the current key.",
    );
    this.name = "SecretUndecryptableError";
  }
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, ctB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new SecretUndecryptableError();
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getKey(),
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (err) {
    // A missing/!32-byte key is a deployment mistake, not stale ciphertext —
    // let that error through so it's diagnosed as configuration.
    if (err instanceof Error && /EMAIL_ENCRYPTION_KEY/.test(err.message)) {
      throw err;
    }
    // Anything else here is GCM auth-tag rejection: wrong key for this value.
    throw new SecretUndecryptableError();
  }
}

/**
 * Non-throwing variant for callers that want to *report* which accounts have
 * become unreadable (e.g. an admin list) rather than fail the whole request.
 */
export function tryDecryptSecret(stored: string): string | null {
  try {
    return decryptSecret(stored);
  } catch (err) {
    if (err instanceof SecretUndecryptableError) return null;
    throw err;
  }
}

/** True when the encryption key is configured — lets the UI warn admins early. */
export function emailEncryptionReady(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}
