import "server-only";
import { ImapFlow, type ImapFlowOptions } from "imapflow";
import nodemailer, { type Transporter } from "nodemailer";
import { simpleParser } from "mailparser";
import { sql } from "@/lib/db";
import { decryptSecret } from "@/lib/emailCrypto";

/**
 * Email connection module. Reads the admin-configured mail server settings and
 * the per-user mailbox credentials from the database (never hardcoded),
 * decrypts the password in-memory, and connects via IMAP (read) / SMTP (send).
 * Serverless-friendly: every call connects, does its work, and disconnects —
 * no persistent IMAP IDLE.
 */

export type Encryption = "ssl_tls" | "starttls";

export interface EmailServerConfig {
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  encryption: Encryption;
}

export interface UserEmailAccount {
  email_address: string;
  username: string;
  password_enc: string;
  enabled: boolean;
}

export interface MessageSummary {
  uid: number;
  subject: string;
  from: string;
  date: string | null;
  seen: boolean;
}

export interface MessageDetail extends MessageSummary {
  to: string;
  text: string;
  html: string | null;
}

const CONNECT_TIMEOUT_MS = 15_000;

// ── Settings loaders ────────────────────────────────────────────────────────

export async function getServerConfig(): Promise<EmailServerConfig | null> {
  const q = sql();
  const rows = (await q`
    select imap_host, imap_port, smtp_host, smtp_port, encryption
    from email_server_config where id = 1
  `) as EmailServerConfig[];
  const row = rows[0];
  if (!row || !row.imap_host || !row.smtp_host) return null;
  return row;
}

export async function getUserAccount(
  userId: number,
): Promise<UserEmailAccount | null> {
  const q = sql();
  const rows = (await q`
    select email_address, username, password_enc, enabled
    from user_email_accounts where user_id = ${userId}
  `) as UserEmailAccount[];
  return rows[0] ?? null;
}

// ── Connection factories ────────────────────────────────────────────────────

function imapOptions(
  config: EmailServerConfig,
  username: string,
  password: string,
): ImapFlowOptions {
  return {
    host: config.imap_host,
    port: config.imap_port,
    // SSL/TLS = implicit TLS from the first byte. STARTTLS = connect plain then
    // upgrade; ImapFlow performs the upgrade automatically when secure:false.
    secure: config.encryption === "ssl_tls",
    auth: { user: username, pass: password },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: 30_000,
  };
}

function smtpTransport(
  config: EmailServerConfig,
  username: string,
  password: string,
): Transporter {
  return nodemailer.createTransport({
    host: config.smtp_host,
    port: config.smtp_port,
    secure: config.encryption === "ssl_tls", // 465 implicit TLS
    requireTLS: config.encryption === "starttls", // 587 STARTTLS, never plain
    auth: { user: username, pass: password },
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
  });
}

// ── Human-readable error mapping ────────────────────────────────────────────

export function describeEmailError(err: unknown): string {
  const e = err as {
    code?: string;
    responseCode?: number;
    authenticationFailed?: boolean;
    message?: string;
  };
  const msg = (e?.message || "").toLowerCase();

  if (
    e?.authenticationFailed ||
    e?.responseCode === 535 ||
    /auth|login failed|invalid credentials|username|password/.test(msg)
  ) {
    return "Authentication failed — check the username and password.";
  }
  if (e?.code === "ENOTFOUND" || /enotfound|getaddrinfo/.test(msg)) {
    return "Host not found — check the IMAP/SMTP hostname.";
  }
  if (e?.code === "ECONNREFUSED" || /econnrefused|connection refused/.test(msg)) {
    return "Connection refused — check the port, or the service may be disabled on the server.";
  }
  if (
    e?.code === "ETIMEDOUT" ||
    e?.code === "CONN_TIMEOUT" ||
    /timeout|timed out/.test(msg)
  ) {
    return "Connection timed out — the port is likely blocked by a firewall, or the host is unreachable.";
  }
  if (
    e?.code === "ESOCKET" ||
    /certificate|ssl|tls|wrong version number|self.signed/.test(msg)
  ) {
    return "Secure handshake failed — check the encryption type (SSL/TLS vs STARTTLS) and that the port matches it.";
  }
  return e?.message || "Connection failed.";
}

// ── Test connection ─────────────────────────────────────────────────────────

export interface TestOutcome {
  ok: boolean;
  error?: string;
}

async function testImap(
  config: EmailServerConfig,
  username: string,
  password: string,
): Promise<TestOutcome> {
  const client = new ImapFlow(imapOptions(config, username, password));
  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (err) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
    return { ok: false, error: describeEmailError(err) };
  }
}

async function testSmtp(
  config: EmailServerConfig,
  username: string,
  password: string,
): Promise<TestOutcome> {
  const transport = smtpTransport(config, username, password);
  try {
    await transport.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describeEmailError(err) };
  } finally {
    transport.close();
  }
}

/** Verifies BOTH IMAP and SMTP login with the given settings (before saving). */
export async function testConnection(
  config: EmailServerConfig,
  username: string,
  password: string,
): Promise<{ imap: TestOutcome; smtp: TestOutcome }> {
  const [imap, smtp] = await Promise.all([
    testImap(config, username, password),
    testSmtp(config, username, password),
  ]);
  return { imap, smtp };
}

// ── Read ────────────────────────────────────────────────────────────────────

function formatAddress(
  addr:
    | { name?: string; address?: string }[]
    | { name?: string; address?: string }
    | undefined
    | null,
): string {
  if (!addr) return "";
  const list = Array.isArray(addr) ? addr : [addr];
  return list
    .map((a) => (a.name ? `${a.name} <${a.address ?? ""}>` : a.address ?? ""))
    .filter(Boolean)
    .join(", ");
}

export async function fetchInbox(
  config: EmailServerConfig,
  account: UserEmailAccount,
  password: string,
  limit = 30,
): Promise<MessageSummary[]> {
  const client = new ImapFlow(imapOptions(config, account.username, password));
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      const total =
        mailbox && typeof mailbox === "object" && "exists" in mailbox
          ? (mailbox.exists as number)
          : 0;
      if (!total) return [];
      const start = Math.max(1, total - limit + 1);
      const out: MessageSummary[] = [];
      for await (const msg of client.fetch(`${start}:*`, {
        uid: true,
        flags: true,
        envelope: true,
      })) {
        out.push({
          uid: msg.uid,
          subject: msg.envelope?.subject || "(no subject)",
          from: formatAddress(msg.envelope?.from),
          date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : null,
          seen: msg.flags?.has("\\Seen") ?? false,
        });
      }
      // Newest first.
      return out.reverse();
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

export async function fetchMessage(
  config: EmailServerConfig,
  account: UserEmailAccount,
  password: string,
  uid: number,
): Promise<MessageDetail | null> {
  const client = new ImapFlow(imapOptions(config, account.username, password));
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const msg = await client.fetchOne(
        String(uid),
        { uid: true, source: true, envelope: true, flags: true },
        { uid: true },
      );
      if (!msg || !msg.source) return null;
      const parsed = await simpleParser(msg.source);
      // Mark as read (best-effort).
      try {
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      } catch {
        /* non-fatal */
      }
      return {
        uid,
        subject: parsed.subject || msg.envelope?.subject || "(no subject)",
        from: formatAddress(
          (parsed.from?.value as { name?: string; address?: string }[]) ??
            msg.envelope?.from,
        ),
        to: formatAddress(
          (parsed.to &&
            !Array.isArray(parsed.to) &&
            (parsed.to.value as { name?: string; address?: string }[])) ||
            msg.envelope?.to,
        ),
        date: parsed.date ? parsed.date.toISOString() : null,
        seen: true,
        text: parsed.text || "",
        html: typeof parsed.html === "string" ? parsed.html : null,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

// ── Send ────────────────────────────────────────────────────────────────────

export async function sendMail(
  config: EmailServerConfig,
  account: UserEmailAccount,
  password: string,
  message: { to: string; subject: string; text: string; html?: string },
): Promise<void> {
  const transport = smtpTransport(config, account.username, password);
  try {
    await transport.sendMail({
      from: account.email_address,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  } finally {
    transport.close();
  }
}

// ── Convenience wrappers used by the /api/email routes ──────────────────────

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("No mailbox is configured for your account. Ask an admin to assign one.");
    this.name = "EmailNotConfiguredError";
  }
}

async function loadForUser(userId: number): Promise<{
  config: EmailServerConfig;
  account: UserEmailAccount;
  password: string;
}> {
  const [config, account] = await Promise.all([
    getServerConfig(),
    getUserAccount(userId),
  ]);
  if (!config || !account || !account.enabled) {
    throw new EmailNotConfiguredError();
  }
  return { config, account, password: decryptSecret(account.password_enc) };
}

export async function fetchInboxForUser(
  userId: number,
  limit = 30,
): Promise<MessageSummary[]> {
  const { config, account, password } = await loadForUser(userId);
  return fetchInbox(config, account, password, limit);
}

export async function fetchMessageForUser(
  userId: number,
  uid: number,
): Promise<MessageDetail | null> {
  const { config, account, password } = await loadForUser(userId);
  return fetchMessage(config, account, password, uid);
}

export async function sendMailForUser(
  userId: number,
  message: { to: string; subject: string; text: string; html?: string },
): Promise<void> {
  const { config, account, password } = await loadForUser(userId);
  return sendMail(config, account, password, message);
}
