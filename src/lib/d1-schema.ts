/**
 * D1 (SQLite) schema bootstrap helpers.
 *
 * The canonical schema lives in `d1/schema.sql` (used by `wrangler` and the
 * Admin → Backups controls). At runtime it's read from the EMBEDDED copy in
 * `d1Schema.generated.ts`, so the bootstrap never depends on fs.readFile /
 * Next.js file-tracing.
 *
 * Robustness contract ("never fall again"):
 *   1. applyD1Schema() runs every `CREATE TABLE IF NOT EXISTS` /
 *      `CREATE INDEX` / `ALTER TABLE ADD COLUMN` idempotently.
 *   2. It then RECONCILES: for every table that exists, any column the schema
 *      declares but the live table is missing is added automatically (nullable,
 *      so it can never fail). So adding a column to a CREATE TABLE in the schema
 *      propagates to existing databases with no hand-written migration.
 *   3. The bootstrap in db.ts keys its "already applied" flag off
 *      d1SchemaVersion() — a hash of the schema text — so ANY edit to the
 *      schema re-runs the heal on the next request automatically.
 */

import { d1Query } from "./db-d1";
import { D1_SCHEMA_SQL } from "./d1Schema.generated";

let cachedStatements: string[] | null = null;
let cachedColumns: Map<string, Array<{ name: string; type: string }>> | null =
  null;

/** The CREATE TABLE / CREATE INDEX / ALTER TABLE statements from the schema. */
export function loadD1SchemaStatements(): string[] {
  if (cachedStatements) return cachedStatements;
  cachedStatements = D1_SCHEMA_SQL.split(";")
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
  return cachedStatements;
}

/** Per-table column list parsed from the CREATE TABLE statements. */
function schemaColumns(): Map<string, Array<{ name: string; type: string }>> {
  if (cachedColumns) return cachedColumns;
  const map = new Map<string, Array<{ name: string; type: string }>>();
  const createRe =
    /CREATE TABLE IF NOT EXISTS\s+"([^"]+)"\s*\(([\s\S]*?)\);/gi;
  let m: RegExpExecArray | null;
  while ((m = createRe.exec(D1_SCHEMA_SQL))) {
    const table = m[1];
    const cols: Array<{ name: string; type: string }> = [];
    for (const rawLine of m[2].split("\n")) {
      const line = rawLine.trim();
      // Column lines look like:  "col" TEXT NOT NULL DEFAULT ''
      // Constraint lines (PRIMARY KEY (...)) don't start with a quoted name.
      const cm = /^"([^"]+)"\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)\b/i.exec(line);
      if (cm) cols.push({ name: cm[1], type: cm[2].toUpperCase() });
    }
    map.set(table, cols);
  }
  cachedColumns = map;
  return map;
}

/**
 * A short deterministic version tag derived from the schema text (FNV-1a).
 * Changes whenever the schema changes, so the bootstrap re-applies the heal.
 */
export function d1SchemaVersion(): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < D1_SCHEMA_SQL.length; i++) {
    h ^= D1_SCHEMA_SQL.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Apply the D1 schema idempotently, then reconcile missing columns.
 * "already exists" / "duplicate column name" count as success. Never drops.
 */
export async function applyD1Schema(): Promise<{
  applied: number;
  skipped: number;
  errors: string[];
}> {
  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];

  // 1. Run the CREATE / ALTER / INDEX statements verbatim.
  for (const stmt of loadD1SchemaStatements()) {
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

  // 2. Reconcile: add any declared column missing on an existing table. Added
  //    nullable so it can never fail; the app enforces values/defaults on
  //    insert. This makes "edit a CREATE TABLE" enough to migrate live DBs.
  for (const [table, cols] of schemaColumns()) {
    let info: Array<Record<string, unknown>>;
    try {
      info = (await d1Query(`PRAGMA table_info("${table}")`)).results;
    } catch {
      continue;
    }
    if (!info || info.length === 0) continue; // table absent (shouldn't happen)
    const have = new Set(info.map((r) => String(r.name)));
    for (const c of cols) {
      if (have.has(c.name)) continue;
      try {
        await d1Query(`ALTER TABLE "${table}" ADD COLUMN "${c.name}" ${c.type}`);
        applied++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/duplicate column name/i.test(msg)) {
          skipped++;
          continue;
        }
        errors.push(`ALTER ${table}.${c.name}: ${msg}`);
      }
    }
  }

  return { applied, skipped, errors };
}
