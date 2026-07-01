import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { buildDbSnapshotZip } from "@/lib/db-snapshot";
import {
  isOffsiteConfigured,
  offsiteIsSameAccount,
  r2PutObjectOffsite,
} from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Off-site database mirror.
 *
 * GET  /api/admin/offsite-mirror  → { configured, sameAccount } so the UI can
 *      show whether an off-site destination exists and whether it's a real
 *      different-account copy or just a different bucket on the same account.
 *
 * POST /api/admin/offsite-mirror  → build a fresh, restore-ready snapshot of
 *      the whole database and upload it to the OFF-SITE R2 destination
 *      (CLOUDFLARE_R2_OFFSITE_*), at both backups/db/latest.zip and a dated
 *      copy. This is the fix for "the only backup copy lives in the same bucket
 *      as the live files" — a one-click copy that lands outside the primary
 *      bucket (and, when the off-site account is set, outside the primary
 *      account entirely).
 *
 * Admin only. Read-only against the live database; writes only to the off-site
 * bucket. Self-contained — it does not depend on the nightly cron having run.
 */
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({
      ok: true,
      configured: isOffsiteConfigured(),
      sameAccount: offsiteIsSameAccount(),
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status =
      msg === "FORBIDDEN" ? 403 : msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

export async function POST() {
  try {
    await requireAdmin();

    if (!isOffsiteConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Off-site destination is not configured. Set CLOUDFLARE_R2_OFFSITE_BUCKET " +
            "(and, for a real off-site copy, CLOUDFLARE_R2_OFFSITE_ACCOUNT_ID / " +
            "_ACCESS_KEY_ID / _SECRET_ACCESS_KEY pointing at a different account).",
        },
        { status: 400 },
      );
    }

    await ensureSchema();
    const { buffer, manifest } = await buildDbSnapshotZip(sql());

    const day = manifest.generatedAt.slice(0, 10); // YYYY-MM-DD (UTC)
    const latestKey = "backups/db/latest.zip";
    const dayKey = `backups/db/${day}.zip`;

    const put = await r2PutObjectOffsite(latestKey, buffer, "application/zip");
    await r2PutObjectOffsite(dayKey, buffer, "application/zip");

    return NextResponse.json({
      ok: true,
      bucket: put.bucket,
      bytes: put.size,
      sameAccount: offsiteIsSameAccount(),
      tables: manifest.tableCount,
      rows: manifest.totalRows,
      keys: [latestKey, dayKey],
      generatedAt: manifest.generatedAt,
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status =
      msg === "FORBIDDEN" ? 403 : msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
