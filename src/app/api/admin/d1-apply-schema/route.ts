import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { d1Query, isD1Configured } from "@/lib/db-d1";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/d1-apply-schema
 *
 * Admin-only. Reads d1/schema.sql from the deployment bundle, splits it into
 * individual DDL statements, and executes each one against D1 via the REST
 * API. Idempotent — uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
 * EXISTS so re-running on a database that already has the schema is safe.
 *
 * Returns:
 *   { applied: number, skipped: number, errors: string[] }
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

    const schemaPath = join(process.cwd(), "d1", "schema.sql");
    let sql: string;
    try {
      sql = await readFile(schemaPath, "utf-8");
    } catch {
      return NextResponse.json(
        { error: "d1/schema.sql not found in deployment. Redeploy the app." },
        { status: 500 },
      );
    }

    // Split on semicolon boundaries. Each element is trimmed and re-checked
    // because the file uses ;\n as the delimiter.
    const rawStatements = sql.split(";").map((s) => s.trim());

    let applied = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const stmt of rawStatements) {
      // Skip blank lines, comments-only chunks, and transaction control.
      if (!stmt) { skipped++; continue; }
      const upper = stmt.replace(/--[^\n]*/g, "").trim().toUpperCase();
      if (
        !upper ||
        upper.startsWith("--") ||
        upper === "PRAGMA FOREIGN_KEYS = OFF" ||
        upper === "PRAGMA FOREIGN_KEYS = ON" ||
        upper === "BEGIN TRANSACTION" ||
        upper === "COMMIT"
      ) {
        skipped++;
        continue;
      }

      // Only allow DDL we expect. Belt-and-suspenders guard against anything
      // unexpected ending up in the schema file. ALTER TABLE ... ADD COLUMN is
      // allowed so an existing D1 database gains columns added after its
      // original bootstrap (e.g. users.tenant_id / department_code).
      if (
        !upper.startsWith("CREATE TABLE") &&
        !upper.startsWith("CREATE UNIQUE INDEX") &&
        !upper.startsWith("CREATE INDEX") &&
        !upper.startsWith("ALTER TABLE") &&
        !upper.startsWith("PRAGMA")
      ) {
        skipped++;
        continue;
      }

      try {
        await d1Query(stmt);
        applied++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Idempotent re-run: the table already exists, or the ALTER is adding a
        // column that's already there. Both are expected on a healthy DB.
        if (/already exists/i.test(msg) || /duplicate column name/i.test(msg)) {
          skipped++;
          continue;
        }
        errors.push(`${stmt.slice(0, 120).replace(/\s+/g, " ")}: ${msg}`);
      }
    }

    return NextResponse.json({ applied, skipped, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
