import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { buildDbSnapshotZip } from "@/lib/db-snapshot";
import { r2PutObject, isR2Configured } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/db-backup
 *
 * Daily automated database backup to Cloudflare R2. Runs the same
 * restore-ready snapshot as the manual Admin → DB backup, but instead of
 * downloading it, uploads the ZIP straight into R2 so a fresh copy of every
 * row is captured every day with no human action — the safety net that means
 * "never be stuck without the data again".
 *
 * Stored at:
 *   backups/db/<YYYY-MM-DD>.zip   one immutable copy per day (history)
 *   backups/db/latest.zip         always the most recent (easy to grab)
 *
 * Wired to a Vercel cron (see vercel.json → crons). Vercel attaches
 * `Authorization: Bearer $CRON_SECRET` to cron requests automatically when the
 * CRON_SECRET env var is set, which is what this route checks. It can also be
 * triggered by hand with `?secret=<CRON_SECRET>` or by a logged-in admin.
 *
 * Read-only against the database. Idempotent (same-day re-run overwrites that
 * day's object).
 */
export async function GET(req: Request) {
  try {
    await assertAuthorized(req);

    if (!isR2Configured()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "R2 not configured. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID " +
            "and CLOUDFLARE_R2_SECRET_ACCESS_KEY in the environment.",
        },
        { status: 503 },
      );
    }

    const { buffer, manifest } = await buildDbSnapshotZip(sql());

    // YYYY-MM-DD from the snapshot's own generation time (UTC).
    const day = manifest.generatedAt.slice(0, 10);
    const dayKey = `backups/db/${day}.zip`;
    const latestKey = `backups/db/latest.zip`;

    const put = await r2PutObject(dayKey, buffer, "application/zip");
    await r2PutObject(latestKey, buffer, "application/zip");

    return NextResponse.json({
      ok: true,
      uploaded: { key: put.key, bucket: put.bucket, bytes: put.size },
      latestKey,
      tables: manifest.tableCount,
      rows: manifest.totalRows,
      generatedAt: manifest.generatedAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

async function assertAuthorized(req: Request): Promise<void> {
  // 1. Vercel cron — it sends `Authorization: Bearer <CRON_SECRET>` when the
  //    CRON_SECRET env var is configured.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth === `Bearer ${cronSecret}`) return;
    // 2. Manual trigger by hand: ?secret=<CRON_SECRET>.
    const url = new URL(req.url);
    if (url.searchParams.get("secret") === cronSecret) return;
  }
  // 3. A logged-in admin can always run it.
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  if (user.role !== "admin") throw new Error("FORBIDDEN");
}
