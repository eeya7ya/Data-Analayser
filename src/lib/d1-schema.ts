/**
 * D1 (SQLite) schema bootstrap helpers.
 *
 * The canonical schema lives in `d1/schema.sql` (used by `wrangler` and the
 * Admin → Backups "Reset D1" button). At runtime it's read from the EMBEDDED
 * copy in `d1Schema.generated.ts` rather than from disk, so the schema
 * bootstrap never depends on fs.readFile / Next.js file-tracing bundling the
 * .sql into every serverless function. These helpers apply it idempotently so
 * the app can self-heal a D1 database on first use — the D1 analogue of the
 * Postgres DDL bootstrap in `src/lib/db.ts`. Every statement is
 * `CREATE ... IF NOT EXISTS` or `ALTER TABLE ... ADD COLUMN`, so re-applying is
 * always safe and nothing is ever dropped.
 */

import { d1Query } from "./db-d1";
import { D1_SCHEMA_SQL } from "./d1Schema.generated";

let cached: string[] | null = null;

/** The CREATE TABLE / CREATE INDEX / ALTER TABLE statements from the schema. */
export function loadD1SchemaStatements(): string[] {
  if (cached) return cached;
  cached = D1_SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter((stmt) => {
      const upper = stmt.replace(/--[^\n]*/g, "").trim().toUpperCase();
      return (
        upper.startsWith("CREATE TABLE") ||
        upper.startsWith("CREATE UNIQUE INDEX") ||
        upper.startsWith("CREATE INDEX") ||
        upper.startsWith("ALTER TABLE")
      );
    });
  return cached;
}

/**
 * Apply the D1 schema idempotently. "already exists" / "duplicate column name"
 * are treated as success (the statement's effect is already present); any other
 * error is collected and returned. Never drops anything.
 */
export async function applyD1Schema(): Promise<{
  applied: number;
  skipped: number;
  errors: string[];
}> {
  const statements = loadD1SchemaStatements();
  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const stmt of statements) {
    try {
      await d1Query(stmt);
      applied++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already exists/i.test(msg) || /duplicate column name/i.test(msg)) {
        skipped++;
        continue;
      }
      errors.push(`${stmt.slice(0, 100).replace(/\s+/g, " ")}: ${msg}`);
    }
  }
  return { applied, skipped, errors };
}
