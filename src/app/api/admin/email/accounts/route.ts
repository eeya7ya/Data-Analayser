import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import { encryptSecret } from "@/lib/emailCrypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AccountRow {
  user_id: number;
  username: string;
  display_name: string | null;
  role: string;
  email_address: string | null;
  mailbox_username: string | null;
  enabled: boolean | null;
  has_password: boolean;
  last_test_ok: boolean | null;
  last_tested_at: string | null;
  last_test_error: string | null;
}

/** Lists every user with their assigned-mailbox status (never the password). */
export async function GET() {
  try {
    await requireAdmin();
    await ensureSchema();
    const q = sql();
    const rows = (await q`
      select u.id as user_id, u.username, u.display_name, u.role,
             a.email_address, a.username as mailbox_username, a.enabled,
             (a.password_enc is not null) as has_password,
             a.last_test_ok, a.last_tested_at, a.last_test_error
      from users u
      left join user_email_accounts a on a.user_id = u.id
      order by u.username asc
    `) as AccountRow[];
    return NextResponse.json({ accounts: rows });
  } catch (err) {
    return fail(err);
  }
}

/** Assign or update a user's mailbox. Password is encrypted before storage; an
 *  omitted/blank password on an existing account keeps the stored one. */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    await ensureSchema();
    const body = (await req.json()) as {
      user_id?: number;
      email_address?: string;
      username?: string;
      password?: string;
      enabled?: boolean;
    };

    const userId = Number(body.user_id);
    const email = String(body.email_address ?? "").trim();
    // The mailbox login is often the full address; default to it when blank.
    const username = String(body.username ?? "").trim() || email;
    const password = String(body.password ?? "");
    const enabled = body.enabled !== false;

    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "Invalid user." }, { status: 400 });
    }
    if (!email) {
      return NextResponse.json(
        { error: "Email address is required." },
        { status: 400 },
      );
    }

    const q = sql();
    const existing = (await q`
      select password_enc from user_email_accounts where user_id = ${userId}
    `) as Array<{ password_enc: string }>;

    if (existing.length === 0 && !password) {
      return NextResponse.json(
        { error: "A password is required when assigning a new mailbox." },
        { status: 400 },
      );
    }

    const passwordEnc =
      password.length > 0
        ? encryptSecret(password)
        : existing[0].password_enc;

    await q`
      insert into user_email_accounts
        (user_id, email_address, username, password_enc, enabled,
         last_test_ok, last_tested_at, last_test_error, updated_at)
      values
        (${userId}, ${email}, ${username}, ${passwordEnc}, ${enabled},
         null, null, null, now())
      on conflict (user_id) do update set
        email_address = excluded.email_address,
        username = excluded.username,
        password_enc = excluded.password_enc,
        enabled = excluded.enabled,
        updated_at = now()
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}

/** Remove a user's mailbox assignment. */
export async function DELETE(req: Request) {
  try {
    await requireAdmin();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const userId = Number(searchParams.get("user_id"));
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "Invalid user." }, { status: 400 });
    }
    const q = sql();
    await q`delete from user_email_accounts where user_id = ${userId}`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : "UNKNOWN";
  const status =
    msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
  return NextResponse.json({ error: msg }, { status });
}
