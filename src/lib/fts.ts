/**
 * SQLite FTS5 full-text search for Cloudflare D1.
 *
 * Why this exists
 * ───────────────
 * Every free-text "search box" in the app was implemented as `col ILIKE
 * '%term%'`. On D1 that is a **full table scan**, and D1 bills on rows *read*,
 * so each search reads every row of the table — the dominant cost driver as the
 * `products` catalogue grows toward 100k+ rows. FTS5 replaces the scan with an
 * inverted-index lookup: a search reads only the matching rows.
 *
 * How it's wired
 * ──────────────
 *   - For each searchable table we create an **external-content** FTS5 virtual
 *     table (`<table>_fts`) that indexes the text columns and points back at the
 *     base table via `content='<table>', content_rowid='id'`. The FTS table
 *     stores only the inverted index, not a copy of the data.
 *   - Three triggers (after insert / delete / update) keep the index in sync, so
 *     the app's normal writes need no changes.
 *   - A one-time `'rebuild'` backfills the index from rows that already exist.
 *
 * This module is created/applied separately from `d1/schema.sql` because the
 * schema-split loader in `src/lib/d1-schema.ts` only understands single
 * `CREATE TABLE/INDEX/ALTER` statements — it cannot create `CREATE VIRTUAL
 * TABLE` or multi-statement `CREATE TRIGGER ... BEGIN ... END` blocks. Callers
 * gate FTS usage on `usingD1() && isFtsReady()` and fall back to the original
 * ILIKE query otherwise (Postgres path, or before the index is built), so
 * behaviour is always correct.
 *
 * No dependency on `db.ts` (only on the low-level `d1Query`) to avoid an import
 * cycle — `db.ts` calls `ensureD1Fts()` during its schema bootstrap.
 */
import { d1Query } from "./db-d1";

/**
 * Searchable tables → the text columns indexed for full-text search. Order is
 * irrelevant to matching (any column can match) but is part of the FTS table
 * definition, so changing it requires bumping FTS_FLAG to rebuild.
 *
 * Only genuine free-text columns are listed. NULLs are fine — FTS5 indexes a
 * NULL column value as empty. The base table's `id` is always the content
 * rowid; soft-deleted rows stay in the index and are filtered by the caller's
 * existing `deleted_at is null` predicate, so no behaviour changes.
 */
export const FTS_TABLES: Record<string, readonly string[]> = {
  products: [
    "vendor",
    "system",
    "category",
    "sub_category",
    "fast_view",
    "model",
    "description",
    "specifications",
    "barcode",
  ],
  companies: ["name", "website", "industry", "notes"],
  contacts: ["first_name", "last_name", "email", "phone", "title", "notes"],
  client_folders: ["name", "client_email", "client_phone", "client_company"],
  quotations: [
    "ref",
    "project_name",
    "client_name",
    "client_email",
    "client_phone",
    "sales_engineer",
    "prepared_by",
    "site_name",
  ],
  purchase_orders: ["po_number", "supplier", "client_name", "project_name"],
  projects: ["name", "description"],
};

export type FtsTable = keyof typeof FTS_TABLES;

/**
 * Bump when FTS_TABLES changes (new table, or a table's column set changes) so
 * existing D1 databases re-create the virtual tables/triggers and rebuild.
 */
const FTS_FLAG = "d1_fts_v1_2026_06_30";

const globalForFts = globalThis as unknown as { __mtFtsReady?: boolean };

/** Whether the FTS virtual tables are confirmed present in this process. */
export function isFtsReady(): boolean {
  return globalForFts.__mtFtsReady === true;
}

/** The DDL statements that create (idempotently) the FTS table + triggers. */
function ftsStatements(table: string, cols: readonly string[]): string[] {
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const newVals = cols.map((c) => `new."${c}"`).join(", ");
  const oldVals = cols.map((c) => `old."${c}"`).join(", ");
  return [
    `CREATE VIRTUAL TABLE IF NOT EXISTS "${table}_fts" USING fts5(${colList}, content='${table}', content_rowid='id')`,
    `CREATE TRIGGER IF NOT EXISTS "${table}_fts_ai" AFTER INSERT ON "${table}" BEGIN
       INSERT INTO "${table}_fts"(rowid, ${colList}) VALUES (new."id", ${newVals});
     END`,
    `CREATE TRIGGER IF NOT EXISTS "${table}_fts_ad" AFTER DELETE ON "${table}" BEGIN
       INSERT INTO "${table}_fts"("${table}_fts", rowid, ${colList}) VALUES ('delete', old."id", ${oldVals});
     END`,
    `CREATE TRIGGER IF NOT EXISTS "${table}_fts_au" AFTER UPDATE ON "${table}" BEGIN
       INSERT INTO "${table}_fts"("${table}_fts", rowid, ${colList}) VALUES ('delete', old."id", ${oldVals});
       INSERT INTO "${table}_fts"(rowid, ${colList}) VALUES (new."id", ${newVals});
     END`,
    // External-content backfill: rebuild reads the base table and (re)populates
    // the index. Idempotent, so re-running is safe; flag-guarded so the (heavy
    // at scale) rebuild only runs once, after which the triggers maintain it.
    `INSERT INTO "${table}_fts"("${table}_fts") VALUES ('rebuild')`,
  ];
}

/**
 * Create the FTS5 virtual tables + triggers and backfill them, once per
 * database. Best-effort: on any failure it leaves `isFtsReady()` false so
 * callers keep using the ILIKE fallback (correct, just unindexed) instead of
 * emitting `MATCH` against a table that doesn't exist. Safe to call on every
 * request — warm processes short-circuit on the in-memory flag, and warm
 * databases short-circuit on a single SELECT.
 */
export async function ensureD1Fts(): Promise<void> {
  if (isFtsReady()) return;

  // Already built on a previous deploy? One SELECT, then we're done.
  try {
    const r = await d1Query<{ one: number }>(
      `select 1 as one from migration_flags where key = ? limit 1`,
      [FTS_FLAG],
    );
    if (r.results.length > 0) {
      globalForFts.__mtFtsReady = true;
      return;
    }
  } catch {
    // migration_flags may not exist yet — fall through and create everything.
  }

  try {
    for (const [table, cols] of Object.entries(FTS_TABLES)) {
      for (const stmt of ftsStatements(table, cols)) {
        await d1Query(stmt);
      }
    }
    await d1Query(
      `insert into migration_flags (key, ran_at) values (?, ?)`,
      [FTS_FLAG, new Date().toISOString()],
    ).catch(() => {});
    globalForFts.__mtFtsReady = true;
  } catch {
    // Leave ready=false; the next call retries and meanwhile searches use the
    // ILIKE fallback so nothing breaks.
    globalForFts.__mtFtsReady = false;
  }
}

// ─── Query helpers ────────────────────────────────────────────────────────────

/** Reduce a raw token to the alphanumerics FTS5's default tokenizer keeps. */
function cleanToken(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Build an FTS5 MATCH expression from groups of tokens, where the OUTER list is
 * AND-ed and each INNER list is OR-ed — e.g. `[["4mp"], ["camera","cctv"]]`
 * becomes `("4mp"*) AND ("camera"* OR "cctv"*)`. Every token is double-quoted
 * (so reserved words like AND/OR/NEAR and punctuation can't break the syntax)
 * and given a `*` prefix so partial words still match ("hik" → "hikvision").
 *
 * Returns null when no usable token survives cleaning, so the caller falls back
 * to its ILIKE predicate.
 */
export function buildMatch(groups: string[][]): string | null {
  const parts: string[] = [];
  for (const group of groups) {
    const toks = group.map(cleanToken).filter(Boolean);
    if (toks.length === 0) continue;
    parts.push("(" + toks.map((t) => `"${t}"*`).join(" OR ") + ")");
  }
  return parts.length ? parts.join(" AND ") : null;
}

/** All tokens OR-ed together (broad recall). */
export function matchAny(tokens: string[]): string | null {
  return buildMatch([tokens]);
}

/** Each token its own AND group (every word must appear somewhere). */
export function matchAll(tokens: string[]): string | null {
  return buildMatch(tokens.map((t) => [t]));
}

/**
 * The SQL predicate that restricts a base-table query to FTS matches:
 *   `<idExpr> in (select rowid from "<table>_fts" where "<table>_fts" match <ph>)`
 * `<ph>` is the placeholder that binds the MATCH string — pass `rawBinder().P`'s
 * output (e.g. `ftsPredicate("companies", "c.id", P(matchStr))`) so positional
 * numbering stays correct, or omit it to get the default `?`. `table` and
 * `idExpr` are caller-supplied literals (never user input), so this is
 * injection-safe. Only ever emit this on the D1 backend (FTS5 is SQLite-only).
 */
export function ftsPredicate(
  table: FtsTable,
  idExpr = "id",
  placeholder = "?",
): string {
  return `${idExpr} in (select rowid from "${table}_fts" where "${table}_fts" match ${placeholder})`;
}
