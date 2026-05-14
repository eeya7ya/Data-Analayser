import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/users/list — minimal directory for pickers.
 *
 * Returns id + username + display_name only. Available to every
 * authenticated user so non-admin managers can populate the
 * project-assignment form and similar pickers without us loosening
 * /api/users (which exposes role + phone and is admin-only).
 *
 * Soft-deleted users are excluded; the live `users` table doesn't
 * have a deleted_at column yet, so this just selects everyone.
 */
export async function GET() {
  try {
    await requireUser();
    await ensureSchema();
    const q = sql();
    const rows = (await q`
      select id, username, coalesce(display_name, '') as display_name
      from users
      order by username asc
    `) as Array<{ id: number; username: string; display_name: string }>;
    return NextResponse.json({ users: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
