import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isD1Configured } from "@/lib/db-d1";
import { applyD1Schema } from "@/lib/d1-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/d1-apply-schema
 *
 * Admin-only. Applies d1/schema.sql to D1 idempotently: every statement is
 * CREATE ... IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / ALTER TABLE ... ADD
 * COLUMN, so re-running is always safe — existing tables are left alone and
 * missing tables/columns are created. The app also applies this automatically
 * on first use (see ensureSchema in src/lib/db.ts); this endpoint is the manual
 * trigger surfaced in Admin → Backups.
 *
 * Returns: { applied: number, skipped: number, errors: string[] }
 */
export async function POST() {
  try {
    await requireAdmin();

    if (!isD1Configured()) {
      return NextResponse.json(
        {
          error:
            "D1 env vars not set. Add CLOUDFLARE_ACCOUNT_ID, " +
            "CLOUDFLARE_D1_DATABASE_ID and CLOUDFLARE_API_TOKEN in Vercel " +
            "Project Settings → Environment Variables, then redeploy.",
        },
        { status: 503 },
      );
    }

    const result = await applyD1Schema();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
