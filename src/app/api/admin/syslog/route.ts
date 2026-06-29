import { NextRequest, NextResponse } from "next/server";
import { requireReadAll, requireAdmin } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { listSyslog, pruneSyslog, resetSyslog } from "@/lib/syslog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/syslog — the admin system-activity log.
 *
 * Admin or viewer may read it. Every read first prunes anything older than
 * the one-month retention window, so the log "resets every month" without a
 * scheduled job. `?limit=` caps the number of returned rows.
 */
export async function GET(req: NextRequest) {
  try {
    await requireReadAll();
    await ensureSchema();
    let purged = 0;
    try {
      purged = await pruneSyslog();
    } catch {
      // Pruning is best-effort; never block the read on it.
    }
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit")) || 200;
    const entries = await listSyslog(limit);
    return NextResponse.json({ entries, purged });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/**
 * DELETE /api/admin/syslog — wipe the log on demand (admin only; viewers are
 * read-only).
 */
export async function DELETE() {
  try {
    await requireAdmin();
    await ensureSchema();
    const removed = await resetSyslog();
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
