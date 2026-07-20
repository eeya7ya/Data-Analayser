import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import {
  requireUser,
  hashPassword,
  verifyPassword,
  createSessionCookie,
} from "@/lib/auth";

export const runtime = "nodejs";

/**
 * POST /api/auth/change-password
 *
 * The user sets their OWN password. This is the only path that clears
 * `must_change_password` — an admin creating or resetting a password always
 * turns the flag back on, so a temporary/admin-set credential can never stick.
 *
 * Requires the current password (the one the user just signed in with), so a
 * hijacked session can't silently rotate the password. On success the session
 * cookie is re-issued with the flag cleared, which lifts the middleware gate
 * immediately without a re-login.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();

    const { currentPassword, newPassword } = (await req.json().catch(() => ({}))) as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current and new password are both required." },
        { status: 400 },
      );
    }
    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "New password must be at least 8 characters." },
        { status: 400 },
      );
    }
    if (newPassword === currentPassword) {
      return NextResponse.json(
        { error: "New password must be different from the current one." },
        { status: 400 },
      );
    }

    const q = sql();
    const rows = (await q`
      select password_hash from users where id = ${user.id} limit 1
    `) as Array<{ password_hash: string }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const ok = await verifyPassword(currentPassword, rows[0].password_hash);
    if (!ok) {
      return NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 400 },
      );
    }

    const hash = await hashPassword(newPassword);
    await q`
      update users
      set password_hash = ${hash}, must_change_password = false
      where id = ${user.id}
    `;

    // Re-issue the session with the gate cleared so the app unlocks right away.
    await createSessionCookie({ ...user, mustChangePassword: false });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
