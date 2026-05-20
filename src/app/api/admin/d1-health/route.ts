import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { d1Query, isD1Configured } from "@/lib/db-d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/d1-health
 *
 * Admin-only smoke test for the D1 REST connection. Does NOT modify any
 * Supabase or D1 state. Useful during the dual-run period to confirm:
 *
 *   1. The CLOUDFLARE_* env vars are set in Vercel.
 *   2. The API token has D1 read permission on the right database.
 *   3. The schema has been applied (table count > 0).
 *   4. Per-table row counts on D1 — to compare against Supabase as data
 *      is migrated table by table.
 *
 * Response shape:
 *   { configured: boolean, tables: Array<{ name: string, rows: number }> }
 *
 * If D1 isn't configured the endpoint returns 200 with `configured: false`
 * (no error) so the admin UI can show a "not yet wired up" state instead
 * of a hard crash.
 */
export async function GET() {
  try {
    await requireAdmin();
    if (!isD1Configured()) {
      return NextResponse.json({
        configured: false,
        message:
          "D1 env vars not set. Add CLOUDFLARE_ACCOUNT_ID, " +
          "CLOUDFLARE_D1_DATABASE_ID and CLOUDFLARE_API_TOKEN in Vercel " +
          "Project Settings → Environment Variables, then redeploy.",
        tables: [],
      });
    }

    // 1. List every user table in the D1 database.
    const tablesRes = await d1Query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
    );
    const tables: Array<{ name: string; rows: number }> = [];

    // 2. For each, COUNT(*). We do this as a serial loop instead of a
    //    batch because the D1 REST API doesn't like dynamic identifiers
    //    in a single batched UNION query, and counting 36 small tables
    //    one at a time is still <1 second.
    for (const t of tablesRes.results) {
      // Sanity: only allow table names that look like SQL identifiers so
      // we never inject untrusted text from sqlite_master into the next
      // SELECT (defence-in-depth — the source is sqlite_master itself,
      // not user input, but it costs nothing to be explicit).
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t.name)) continue;
      const countRes = await d1Query<{ c: number }>(
        `SELECT COUNT(*) AS c FROM "${t.name}"`,
      );
      tables.push({ name: t.name, rows: Number(countRes.results[0]?.c ?? 0) });
    }

    return NextResponse.json({ configured: true, tables });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ configured: false, error: msg }, { status });
  }
}
