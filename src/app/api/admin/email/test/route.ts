import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import { decryptSecret, SecretUndecryptableError } from "@/lib/emailCrypto";
import {
  testConnection,
  getServerConfig,
  getUserAccount,
  type Encryption,
  type EmailServerConfig,
} from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ENCRYPTION: Encryption[] = ["ssl_tls", "starttls"];

/**
 * Verifies IMAP + SMTP before anything is trusted. Two modes:
 *   • { user_id }                       → test that user's SAVED mailbox using
 *                                          the saved server config; records the
 *                                          result on the account row.
 *   • { imap_host, …, username, password } → test ad-hoc settings before saving.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    await ensureSchema();
    const body = (await req.json()) as Record<string, unknown>;

    let config: EmailServerConfig;
    let username: string;
    let password: string;
    const savedUserId =
      body.user_id != null ? Number(body.user_id) : NaN;
    const testingSavedAccount =
      Number.isInteger(savedUserId) && savedUserId > 0 && body.password == null;

    if (testingSavedAccount) {
      const [cfg, account] = await Promise.all([
        getServerConfig(),
        getUserAccount(savedUserId),
      ]);
      if (!cfg) {
        return NextResponse.json(
          { error: "Save the mail server settings first." },
          { status: 400 },
        );
      }
      if (!account) {
        return NextResponse.json(
          { error: "This user has no mailbox assigned yet." },
          { status: 400 },
        );
      }
      config = cfg;
      username = account.username;
      password = decryptSecret(account.password_enc);
    } else {
      config = {
        imap_host: String(body.imap_host ?? "").trim(),
        imap_port: Number(body.imap_port),
        smtp_host: String(body.smtp_host ?? "").trim(),
        smtp_port: Number(body.smtp_port),
        encryption: body.encryption as Encryption,
      };
      username = String(body.username ?? "").trim();
      password = String(body.password ?? "");
      if (!config.imap_host || !config.smtp_host || !username || !password) {
        return NextResponse.json(
          { error: "Host, port, username and password are all required to test." },
          { status: 400 },
        );
      }
      if (!VALID_ENCRYPTION.includes(config.encryption)) {
        return NextResponse.json(
          { error: "Invalid encryption type." },
          { status: 400 },
        );
      }
    }

    const result = await testConnection(config, username, password);

    // Persist the outcome on the user's row when testing a saved account.
    if (testingSavedAccount) {
      const ok = result.imap.ok && result.smtp.ok;
      const errText =
        [result.imap.error, result.smtp.error].filter(Boolean).join(" / ") ||
        null;
      const q = sql();
      await q`
        update user_email_accounts
        set last_test_ok = ${ok}, last_tested_at = now(), last_test_error = ${errText}
        where user_id = ${savedUserId}
      `;
    }

    return NextResponse.json(result);
  } catch (err) {
    // Testing a saved account whose password predates the current
    // EMAIL_ENCRYPTION_KEY: report it as a failed test with the fix, rather
    // than a 500. `ok: false` keeps the response shape the UI already renders.
    if (err instanceof SecretUndecryptableError) {
      return NextResponse.json(
        { ok: false, error: err.message, credentialsStale: true },
        { status: 200 },
      );
    }
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
