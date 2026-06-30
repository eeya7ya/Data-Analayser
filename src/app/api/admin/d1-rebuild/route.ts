import { NextResponse } from "next/server";
import { requireAdmin, ensureDefaultAdmin } from "@/lib/auth";
import { resetSchemaCache } from "@/lib/db";
import { d1Query, isD1Configured } from "@/lib/db-d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/d1-rebuild   body: { confirm: "DELETE EVERYTHING" }
 *
 * DESTRUCTIVE, admin-only. Starts the D1 database completely fresh:
 *   1. Drops every app table (all data is permanently deleted).
 *   2. Recreates the full, current schema from scratch (perfect, no drift).
 *   3. Re-seeds the default admin so you can log back in.
 *
 * Requires the exact confirmation phrase so it can't fire by accident.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();

    if (!isD1Configured()) {
      return NextResponse.json(
        { error: "D1 is not configured (set the CLOUDFLARE_* env vars)." },
        { status: 503 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as { confirm?: string };
    if (body?.confirm !== "DELETE EVERYTHING") {
      return NextResponse.json(
        { error: 'Confirmation required: send { "confirm": "DELETE EVERYTHING" }.' },
        { status: 400 },
      );
    }

    // 1. Drop every app table (skip SQLite/D1 internal tables).
    const tables = (
      await d1Query<{ name: string }>(
        `select name from sqlite_master
         where type = 'table'
           and name not like 'sqlite_%'
           and name not like '_cf_%'
           and name not like 'd1_%'`,
      )
    ).results;
    let dropped = 0;
    const errors: string[] = [];
    for (const t of tables) {
      try {
        await d1Query(`DROP TABLE IF EXISTS "${t.name}"`);
        dropped++;
      } catch (err) {
        errors.push(`drop ${t.name}: ${err instanceof Error ? err.message : err}`);
      }
    }

    // 2 + 3. Rebuild the schema and re-seed the admin via the normal bootstrap.
    // resetSchemaCache() clears the in-process guard so ensureSchema actually
    // re-applies the (now-empty) D1 schema before the admin is seeded.
    await resetSchemaCache();
    await ensureDefaultAdmin();

    const tableCount = (
      await d1Query<{ n: number }>(
        `select count(*) as n from sqlite_master
         where type = 'table' and name not like 'sqlite_%'`,
      )
    ).results[0]?.n;

    return NextResponse.json({
      ok: true,
      dropped,
      tables: Number(tableCount ?? 0),
      errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
