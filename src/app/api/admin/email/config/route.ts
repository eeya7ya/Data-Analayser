import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import { emailEncryptionReady } from "@/lib/emailCrypto";
import type { Encryption, EmailServerConfig } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ENCRYPTION: Encryption[] = ["ssl_tls", "starttls"];

export async function GET() {
  try {
    await requireAdmin();
    await ensureSchema();
    const q = sql();
    const rows = (await q`
      select imap_host, imap_port, smtp_host, smtp_port, encryption
      from email_server_config where id = 1
    `) as EmailServerConfig[];
    return NextResponse.json({
      config: rows[0] ?? null,
      encryptionReady: emailEncryptionReady(),
    });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    await ensureSchema();
    const body = (await req.json()) as Partial<EmailServerConfig>;

    const imap_host = String(body.imap_host ?? "").trim();
    const smtp_host = String(body.smtp_host ?? "").trim();
    const imap_port = Number(body.imap_port);
    const smtp_port = Number(body.smtp_port);
    const encryption = body.encryption as Encryption;

    if (!imap_host || !smtp_host) {
      return NextResponse.json(
        { error: "IMAP and SMTP host are required." },
        { status: 400 },
      );
    }
    if (!isPort(imap_port) || !isPort(smtp_port)) {
      return NextResponse.json(
        { error: "Ports must be between 1 and 65535." },
        { status: 400 },
      );
    }
    if (!VALID_ENCRYPTION.includes(encryption)) {
      return NextResponse.json(
        { error: "Encryption must be 'ssl_tls' or 'starttls'." },
        { status: 400 },
      );
    }

    const q = sql();
    await q`
      insert into email_server_config
        (id, imap_host, imap_port, smtp_host, smtp_port, encryption, updated_at, updated_by)
      values
        (1, ${imap_host}, ${imap_port}, ${smtp_host}, ${smtp_port}, ${encryption}, now(), ${admin.id})
      on conflict (id) do update set
        imap_host = excluded.imap_host,
        imap_port = excluded.imap_port,
        smtp_host = excluded.smtp_host,
        smtp_port = excluded.smtp_port,
        encryption = excluded.encryption,
        updated_at = now(),
        updated_by = excluded.updated_by
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}

function isPort(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : "UNKNOWN";
  const status =
    msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
  return NextResponse.json({ error: msg }, { status });
}
