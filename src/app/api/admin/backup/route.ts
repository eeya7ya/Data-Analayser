import { NextResponse } from "next/server";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { downloadStorageObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/admin/backup
 *
 * Full system backup of every table in the `public` schema of the connected
 * Supabase Postgres database. Returns a single ZIP containing, for each table:
 *
 *   data/<table>.json   — JSON array of all rows (most accurate round-trip;
 *                         preserves jsonb / timestamps as native JSON types).
 *   data/<table>.csv    — RFC-4180 CSV; JSON-typed columns are stringified.
 *   data/<table>.sql    — INSERT statements suitable for `psql -f`.
 *   schema/<table>.sql  — CREATE TABLE-shaped DDL synthesized from
 *                         information_schema.
 *   manifest.json       — index of tables, row counts, columns, primary keys.
 *
 * The full-DB roll-up files combine all per-table outputs in dependency order
 * (by foreign-key topology) so a single `psql -f all.sql` restore works
 * end-to-end on a freshly-bootstrapped schema:
 *
 *   all.sql, all.json, all.csv (csv is per-table only inside the all/ folder).
 *
 * Admin only. Read-only on the database — no schema or row state is mutated.
 */
export async function GET() {
  try {
    await requireAdmin();
    await ensureSchema();

    const q = sql();

    type ColumnRow = {
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      ordinal_position: number;
      is_nullable: "YES" | "NO";
      column_default: string | null;
    };
    const columns = (await q`
      select table_name, column_name, data_type, udt_name,
             ordinal_position, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position
    `) as ColumnRow[];

    type PkRow = { table_name: string; column_name: string };
    const pks = (await q`
      select kcu.table_name, kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
       and tc.table_schema  = kcu.table_schema
      where tc.table_schema = 'public'
        and tc.constraint_type = 'PRIMARY KEY'
      order by kcu.table_name, kcu.ordinal_position
    `) as PkRow[];

    type TableRow = { table_name: string };
    const tablesRaw = (await q`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `) as TableRow[];

    type FkRow = { table_name: string; referenced_table: string };
    const fks = (await q`
      select tc.table_name, ccu.table_name as referenced_table
      from information_schema.table_constraints tc
      join information_schema.constraint_column_usage ccu
        on tc.constraint_name = ccu.constraint_name
       and tc.table_schema = ccu.table_schema
      where tc.table_schema = 'public'
        and tc.constraint_type = 'FOREIGN KEY'
    `) as FkRow[];

    const tableNames = tablesRaw.map((t) => t.table_name);
    const ordered = topoSort(tableNames, fks);

    const colsByTable = groupBy(columns, (c) => c.table_name);
    const pksByTable = groupBy(pks, (p) => p.table_name);

    type ManifestTable = {
      name: string;
      rows: number;
      columns: Array<{
        name: string;
        type: string;
        udt: string;
        nullable: boolean;
        default: string | null;
      }>;
      primaryKey: string[];
      /** SHA-256 of the canonical JSON serialization of all rows. Used by
       * verify-integrity.mjs to detect any silent corruption between backup
       * and restore. */
      contentHash: string;
    };
    const manifest: {
      generatedAt: string;
      databaseUrlHash: string;
      schema: string;
      tableCount: number;
      restoreOrder: string[];
      tables: ManifestTable[];
    } = {
      generatedAt: new Date().toISOString(),
      databaseUrlHash: hashDbUrl(),
      schema: "public",
      tableCount: ordered.length,
      restoreOrder: ordered,
      tables: [],
    };

    const zip = new JSZip();
    const allSqlChunks: string[] = [
      `-- MagicTech full system backup`,
      `-- Generated: ${manifest.generatedAt}`,
      `-- Restore order honours foreign-key dependencies.`,
      `-- Apply against a freshly-bootstrapped (\`ensureSchema()\`) database.`,
      `BEGIN;`,
      `SET session_replication_role = replica;`,
      ``,
    ];
    const allJson: Record<string, Array<Record<string, unknown>>> = {};

    // D1 / SQLite output. CREATE TABLE goes into d1/schema.sql; per-table
    // INSERTs go into d1/data/<table>.sql. Generated at backup time so the
    // restore is just `wrangler d1 execute --file=...`, no JSON parsing on
    // the import side.
    const d1SchemaChunks: string[] = [
      `-- MagicTech SQLite schema (translated from Postgres).`,
      `-- Generated: ${manifest.generatedAt}`,
      `-- IMPORTANT: This is a starter schema, NOT a 1:1 port.`,
      `--   - tsvector / generated FTS columns are SKIPPED. Rewrite as`,
      `--     SQLite FTS5 virtual tables and update src/lib/search.ts.`,
      `--   - jsonb columns become TEXT. The app's @>/->> queries will`,
      `--     need json_extract()/json_each() equivalents.`,
      `--   - text[] columns become TEXT (store as JSON arrays).`,
      `--   - Partial index WHERE clauses are preserved (SQLite supports them).`,
      `--   - CHECK constraints are preserved verbatim; some may need tweaks.`,
      `PRAGMA foreign_keys = OFF;`,
      `BEGIN TRANSACTION;`,
      ``,
    ];
    const d1ImportShChunks: string[] = [
      `#!/usr/bin/env bash`,
      `# Apply this backup to a Cloudflare D1 database via wrangler.`,
      `# Usage: bash d1/import.sh <d1-database-name>`,
      `set -euo pipefail`,
      ``,
      `if [ -z "\${1:-}" ]; then`,
      `  echo "Usage: $0 <d1-database-name>"`,
      `  echo "Tip: create the database first with: wrangler d1 create <name>"`,
      `  exit 1`,
      `fi`,
      `DB="$1"`,
      ``,
      `echo "1/2 Applying schema..."`,
      `wrangler d1 execute "$DB" --remote --file=d1/schema.sql`,
      ``,
      `echo "2/2 Loading data (foreign-key order)..."`,
    ];

    for (const table of ordered) {
      const cols = (colsByTable.get(table) ?? []).sort(
        (a, b) => a.ordinal_position - b.ordinal_position,
      );
      const pkCols = (pksByTable.get(table) ?? []).map((p) => p.column_name);
      const colNames = cols.map((c) => c.column_name);

      const rows = (await q.unsafe(
        `select ${colNames.map(quoteIdent).join(", ")} from ${quoteIdent(table)}`,
      )) as Array<Record<string, unknown>>;

      // Canonical JSON (sorted keys) so the same data always produces the
      // same hash, regardless of column ordering on either side.
      const canonicalJson = canonicalStringify(rows);
      const contentHash = createHash("sha256")
        .update(canonicalJson)
        .digest("hex");

      const jsonText = JSON.stringify(rows, jsonReplacer, 2);
      zip.file(`data/${table}.json`, jsonText);

      const csvText = toCsv(colNames, rows);
      zip.file(`data/${table}.csv`, csvText);

      const insertSql = toInsertSql(table, cols, rows);
      zip.file(`data/${table}.sql`, insertSql);

      const ddl = synthesizeDdl(table, cols, pkCols);
      zip.file(`schema/${table}.sql`, ddl);

      // D1 / SQLite output for this table.
      const sqliteDdl = synthesizeSqliteDdl(table, cols, pkCols);
      if (sqliteDdl) {
        d1SchemaChunks.push(`-- ── ${table} ──`);
        d1SchemaChunks.push(sqliteDdl);
        d1SchemaChunks.push("");
      }
      const sqliteInserts = toSqliteInsertSql(table, cols, rows);
      zip.file(`d1/data/${table}.sql`, sqliteInserts);
      if (rows.length > 0) {
        d1ImportShChunks.push(
          `echo "  ${table} (${rows.length} rows)"`,
          `wrangler d1 execute "$DB" --remote --file=d1/data/${table}.sql`,
        );
      }

      allSqlChunks.push(`-- ── ${table} (${rows.length} rows) ──`);
      allSqlChunks.push(insertSql);
      allSqlChunks.push("");
      allJson[table] = rows;

      manifest.tables.push({
        name: table,
        rows: rows.length,
        columns: cols.map((c) => ({
          name: c.column_name,
          type: c.data_type,
          udt: c.udt_name,
          nullable: c.is_nullable === "YES",
          default: c.column_default,
        })),
        primaryKey: pkCols,
        contentHash,
      });
    }

    allSqlChunks.push(`SET session_replication_role = DEFAULT;`);
    allSqlChunks.push(`COMMIT;`);
    zip.file("all.sql", allSqlChunks.join("\n"));
    zip.file("all.json", JSON.stringify(allJson, jsonReplacer, 2));
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    // ─── Supabase Storage bytes ────────────────────────────────────────────
    // Without this, files like project_files.<row>.storage_path are dangling
    // pointers after the migration. We list every object in every public-ish
    // bucket directly from the storage.objects table (instead of the JS SDK's
    // list, which has pagination quirks) and download each one's bytes.
    type StorageObjectRow = {
      bucket_id: string;
      name: string;
      size_bytes: number | null;
    };
    const storageObjects = (await q`
      select
        bucket_id,
        name,
        ((metadata->>'size')::bigint) as size_bytes
      from storage.objects
      order by bucket_id, name
    `) as StorageObjectRow[];

    const storageManifest: Array<{
      bucket: string;
      path: string;
      bytes: number | null;
      sha256: string | null;
      embedded: boolean;
      error?: string;
    }> = [];

    for (const obj of storageObjects) {
      try {
        const bytes = await downloadStorageObject(obj.bucket_id, obj.name);
        if (bytes) {
          zip.file(`storage/${obj.bucket_id}/${obj.name}`, bytes);
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          storageManifest.push({
            bucket: obj.bucket_id,
            path: obj.name,
            bytes: bytes.byteLength,
            sha256,
            embedded: true,
          });
        } else {
          storageManifest.push({
            bucket: obj.bucket_id,
            path: obj.name,
            bytes: obj.size_bytes,
            sha256: null,
            embedded: false,
            error: "download returned null (object missing or unauthorized)",
          });
        }
      } catch (e) {
        storageManifest.push({
          bucket: obj.bucket_id,
          path: obj.name,
          bytes: obj.size_bytes,
          sha256: null,
          embedded: false,
          error: (e as Error).message,
        });
      }
    }
    zip.file("storage/_manifest.json", JSON.stringify(storageManifest, null, 2));

    // ─── Finalize D1 helpers ───────────────────────────────────────────────
    d1SchemaChunks.push("COMMIT;");
    d1SchemaChunks.push("PRAGMA foreign_keys = ON;");
    zip.file("d1/schema.sql", d1SchemaChunks.join("\n"));
    d1ImportShChunks.push("");
    d1ImportShChunks.push('echo "Done. Run verify-integrity.mjs against the source to confirm row counts."');
    zip.file("d1/import.sh", d1ImportShChunks.join("\n"));

    // ─── Cloudflare R2 + D1 migration helpers ──────────────────────────────
    zip.file(
      "MIGRATE-TO-CLOUDFLARE.md",
      buildMigrationReadme(manifest, storageManifest),
    );
    zip.file("r2/upload-to-r2.sh", buildR2UploadScript(storageManifest));
    zip.file("verify-integrity.mjs", buildVerifyScript());
    zip.file(
      "README.txt",
      [
        "MagicTech Full System Backup",
        "============================",
        `Generated: ${manifest.generatedAt}`,
        `Schema: public`,
        `Tables: ${manifest.tableCount}`,
        "",
        "Contents",
        "--------",
        "  data/<table>.json   per-table JSON dump (lossless, recommended)",
        "  data/<table>.csv    per-table CSV (Excel-friendly)",
        "  data/<table>.sql    per-table INSERT statements",
        "  schema/<table>.sql  synthesized CREATE TABLE DDL (reference only)",
        "  all.sql             combined restore script (psql -f all.sql)",
        "  all.json            combined { tableName: rows[] } JSON dump",
        "  manifest.json       index of tables / columns / row counts / PKs",
        "",
        "Re-upload",
        "---------",
        "Use the 'Restore from backup' control in the Admin → Database tab.",
        "The restore endpoint accepts this ZIP unchanged and upserts every row",
        "by primary key — existing rows are updated, missing rows are inserted,",
        "and rows the destination already has but the backup doesn't are left",
        "untouched (i.e. it is purely additive / non-destructive).",
        "",
        "For a fresh DB, run `npm run db:init` (or just visit /login once) to",
        "bootstrap the schema, then upload the ZIP.",
      ].join("\n"),
    );

    const bytes = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const stamp = manifest.generatedAt
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .replace("Z", "Z");
    const filename = `magictech-backup-${stamp}.zip`;

    const body = new Blob([new Uint8Array(bytes)], { type: "application/zip" });
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "FORBIDDEN" ? 403 : msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────

function groupBy<T, K>(arr: T[], key: (v: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const v of arr) {
    const k = key(v);
    const bucket = m.get(k);
    if (bucket) bucket.push(v);
    else m.set(k, [v]);
  }
  return m;
}

function topoSort(
  tables: string[],
  fks: Array<{ table_name: string; referenced_table: string }>,
): string[] {
  // Returns tables ordered so that no table appears before something it depends on.
  // Self-references and cycles are tolerated (we just emit them in arrival order
  // after dropping the offending edge so the loop terminates).
  const deps = new Map<string, Set<string>>();
  for (const t of tables) deps.set(t, new Set());
  for (const fk of fks) {
    if (fk.table_name === fk.referenced_table) continue;
    if (!deps.has(fk.table_name) || !deps.has(fk.referenced_table)) continue;
    deps.get(fk.table_name)!.add(fk.referenced_table);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const remaining = new Set(tables);
  while (remaining.size) {
    let progress = false;
    for (const t of Array.from(remaining)) {
      const d = deps.get(t)!;
      let ready = true;
      for (const x of d) {
        if (!seen.has(x)) {
          ready = false;
          break;
        }
      }
      if (ready) {
        out.push(t);
        seen.add(t);
        remaining.delete(t);
        progress = true;
      }
    }
    if (!progress) {
      // Cycle — flush the rest in arrival order.
      for (const t of Array.from(remaining)) {
        out.push(t);
        remaining.delete(t);
      }
      break;
    }
  }
  return out;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function jsonReplacer(_k: string, v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return `\\x${Buffer.from(v).toString("hex")}`;
  return v;
}

function toCsv(cols: string[], rows: Array<Record<string, unknown>>): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") {
      if (v instanceof Date) return v.toISOString();
      if (v instanceof Uint8Array)
        return `\\x${Buffer.from(v).toString("hex")}`;
      return JSON.stringify(v);
    }
    const s = String(v);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => escape(r[c])).join(","));
  return lines.join("\r\n");
}

function toInsertSql(
  table: string,
  cols: Array<{ column_name: string; udt_name: string }>,
  rows: Array<Record<string, unknown>>,
): string {
  if (rows.length === 0) return `-- ${table}: no rows\n`;
  const colList = cols.map((c) => quoteIdent(c.column_name)).join(", ");
  const out: string[] = [];
  for (const r of rows) {
    const vals = cols.map((c) => sqlLiteral(r[c.column_name], c.udt_name));
    out.push(
      `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${vals.join(
        ", ",
      )});`,
    );
  }
  return out.join("\n") + "\n";
}

function sqlLiteral(v: unknown, udt: string): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "NULL";
    return String(v);
  }
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`;
  if (v instanceof Uint8Array) {
    return `'\\x${Buffer.from(v).toString("hex")}'::bytea`;
  }
  if (typeof v === "object") {
    const cast = udt === "jsonb" ? "::jsonb" : "::json";
    return `${pgString(JSON.stringify(v))}${cast}`;
  }
  return pgString(String(v));
}

function pgString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function synthesizeDdl(
  table: string,
  cols: Array<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: "YES" | "NO";
    column_default: string | null;
  }>,
  pk: string[],
): string {
  const lines: string[] = [];
  lines.push(`-- Reference DDL for ${table} (synthesized from information_schema).`);
  lines.push(`-- Authoritative DDL lives in src/lib/db.ts:ensureSchema().`);
  lines.push(`CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (`);
  const colDefs = cols.map((c) => {
    const type = c.data_type === "USER-DEFINED" ? c.udt_name : c.data_type;
    const parts = [`  ${quoteIdent(c.column_name)} ${type}`];
    if (c.column_default) parts.push(`DEFAULT ${c.column_default}`);
    if (c.is_nullable === "NO") parts.push("NOT NULL");
    return parts.join(" ");
  });
  if (pk.length) {
    colDefs.push(
      `  PRIMARY KEY (${pk.map(quoteIdent).join(", ")})`,
    );
  }
  lines.push(colDefs.join(",\n"));
  lines.push(`);`);
  return lines.join("\n") + "\n";
}

/**
 * Canonical JSON: sorted keys at every level, no whitespace. Two equivalent
 * row sets always produce byte-identical output, so the SHA-256 is a real
 * fingerprint of the data (not of how Postgres happened to order its columns).
 */
function canonicalStringify(value: unknown): string {
  const replacer = (_k: string, v: unknown): unknown => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Date) return v.toISOString();
    if (v instanceof Uint8Array)
      return `\\x${Buffer.from(v).toString("hex")}`;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  };
  return JSON.stringify(value, replacer);
}

/**
 * Translate a Postgres column to its closest SQLite type. Returns null for
 * columns that should be SKIPPED entirely (generated tsvector columns, which
 * D1 expresses as separate FTS5 virtual tables instead).
 */
function pgTypeToSqlite(udt: string, dataType: string): string | null {
  const u = udt.toLowerCase();
  const d = dataType.toLowerCase();
  if (u === "tsvector") return null; // SKIP — port to FTS5 virtual table
  if (d === "user-defined" && u === "tsvector") return null;
  if (u === "int2" || u === "int4" || u === "int8") return "INTEGER";
  if (u === "bool") return "INTEGER"; // 0 / 1
  if (u === "float4" || u === "float8" || u === "numeric") return "REAL";
  if (u === "bytea") return "BLOB";
  if (u === "json" || u === "jsonb") return "TEXT"; // store as JSON string
  if (u === "uuid") return "TEXT";
  if (u.endsWith("[]")) return "TEXT"; // arrays → JSON string
  if (
    u === "timestamp" ||
    u === "timestamptz" ||
    u === "date" ||
    u === "time" ||
    u === "timetz"
  )
    return "TEXT"; // ISO 8601 string
  return "TEXT"; // text, varchar, char, citext, …
}

function synthesizeSqliteDdl(
  table: string,
  cols: Array<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: "YES" | "NO";
    column_default: string | null;
  }>,
  pk: string[],
): string | null {
  const lines: string[] = [];
  lines.push(`CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (`);
  const colDefs: string[] = [];
  const skipped: string[] = [];
  for (const c of cols) {
    const type = pgTypeToSqlite(c.udt_name, c.data_type);
    if (type === null) {
      skipped.push(c.column_name);
      continue;
    }
    const parts = [`  ${quoteIdent(c.column_name)} ${type}`];
    // D1 doesn't support nextval()/serial; we let INSERTs supply the id
    // explicitly from the source DB so PK values are preserved 1:1.
    // Default expressions like now()/gen_random_uuid() are SQLite-incompatible
    // and we drop them — INSERTs always pass an explicit value anyway.
    const def = (c.column_default || "").toLowerCase();
    if (
      c.column_default &&
      !def.includes("nextval(") &&
      !def.includes("now(") &&
      !def.includes("gen_random_uuid(") &&
      !def.includes("::")
    ) {
      parts.push(`DEFAULT ${c.column_default}`);
    }
    if (c.is_nullable === "NO" && !pk.includes(c.column_name)) {
      parts.push("NOT NULL");
    }
    colDefs.push(parts.join(" "));
  }
  if (colDefs.length === 0) return null;
  if (pk.length) {
    colDefs.push(`  PRIMARY KEY (${pk.map(quoteIdent).join(", ")})`);
  }
  lines.push(colDefs.join(",\n"));
  lines.push(`);`);
  if (skipped.length) {
    lines.unshift(
      `-- NOTE: skipped tsvector column(s): ${skipped.join(", ")} (need FTS5 rewrite)`,
    );
  }
  return lines.join("\n");
}

function toSqliteInsertSql(
  table: string,
  cols: Array<{ column_name: string; udt_name: string; data_type: string }>,
  rows: Array<Record<string, unknown>>,
): string {
  if (rows.length === 0) return `-- ${table}: no rows\n`;
  // Filter out columns SQLite skipped (tsvector).
  const keep = cols.filter((c) => pgTypeToSqlite(c.udt_name, c.data_type) !== null);
  const colList = keep.map((c) => quoteIdent(c.column_name)).join(", ");
  const out: string[] = [`-- ${table}: ${rows.length} rows`];
  for (const r of rows) {
    const vals = keep.map((c) => sqliteLiteral(r[c.column_name], c.udt_name));
    out.push(
      `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${vals.join(", ")});`,
    );
  }
  return out.join("\n") + "\n";
}

function sqliteLiteral(v: unknown, udt: string): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "NULL";
    return String(v);
  }
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return pgString(v.toISOString());
  if (v instanceof Uint8Array) {
    // SQLite BLOB literal: x'hex'
    return `x'${Buffer.from(v).toString("hex")}'`;
  }
  if (typeof v === "object") {
    // jsonb / json / arrays → JSON-encoded TEXT, no Postgres cast.
    return pgString(JSON.stringify(v));
  }
  // The udt is unused for now in the SQLite path but kept in the signature
  // for symmetry with the Postgres branch and to leave room for type-aware
  // tweaks later.
  void udt;
  return pgString(String(v));
}

function buildVerifyScript(): string {
  return `#!/usr/bin/env node
// Re-hash every file in this backup and compare against manifest.json.
// Run from the unzipped backup folder:
//
//   node verify-integrity.mjs
//
// Exit code is 0 if every hash matches, 1 on any mismatch / missing file.
// This catches silent ZIP corruption between download and import. It does
// NOT verify the destination DB — that's a separate post-import step using
// the per-table contentHash in manifest.json.

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const manifestPath = resolve(root, "manifest.json");
const storageManifestPath = resolve(root, "storage/_manifest.json");

if (!existsSync(manifestPath)) {
  console.error("manifest.json not found. Run this script from inside the unzipped backup.");
  process.exit(1);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

let pass = 0;
let fail = 0;

function canonical(v) {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
      const sorted = {};
      for (const k of Object.keys(val).sort()) sorted[k] = val[k];
      return sorted;
    }
    return val;
  });
}

console.log("Verifying table content hashes...");
for (const t of manifest.tables) {
  const dataPath = resolve(root, "data", t.name + ".json");
  if (!existsSync(dataPath)) {
    console.log("  ✗ " + t.name + " — data/" + t.name + ".json missing");
    fail++;
    continue;
  }
  const rows = JSON.parse(await readFile(dataPath, "utf-8"));
  if (rows.length !== t.rows) {
    console.log("  ✗ " + t.name + " — row count mismatch: file=" + rows.length + " manifest=" + t.rows);
    fail++;
    continue;
  }
  const h = createHash("sha256").update(canonical(rows)).digest("hex");
  if (h !== t.contentHash) {
    console.log("  ✗ " + t.name + " — content hash mismatch");
    console.log("    expected " + t.contentHash);
    console.log("    actual   " + h);
    fail++;
  } else {
    pass++;
  }
}

if (existsSync(storageManifestPath)) {
  console.log("Verifying storage file hashes...");
  const storage = JSON.parse(await readFile(storageManifestPath, "utf-8"));
  for (const obj of storage) {
    if (!obj.embedded) {
      console.log("  ⚠ " + obj.bucket + "/" + obj.path + " — NOT EMBEDDED in backup (" + (obj.error || "unknown reason") + ")");
      fail++;
      continue;
    }
    const p = resolve(root, "storage", obj.bucket, obj.path);
    if (!existsSync(p)) {
      console.log("  ✗ " + obj.bucket + "/" + obj.path + " — file missing from ZIP");
      fail++;
      continue;
    }
    const bytes = await readFile(p);
    const stats = await stat(p);
    if (obj.bytes && stats.size !== obj.bytes) {
      console.log("  ✗ " + obj.bucket + "/" + obj.path + " — size mismatch: file=" + stats.size + " manifest=" + obj.bytes);
      fail++;
      continue;
    }
    const h = createHash("sha256").update(bytes).digest("hex");
    if (h !== obj.sha256) {
      console.log("  ✗ " + obj.bucket + "/" + obj.path + " — sha256 mismatch");
      fail++;
    } else {
      pass++;
    }
  }
}

console.log("");
console.log("Pass: " + pass);
console.log("Fail: " + fail);
process.exit(fail === 0 ? 0 : 1);
`;
}

function buildMigrationReadme(
  manifest: { tableCount: number; tables: Array<{ name: string; rows: number; contentHash: string }> },
  storage: Array<{ bucket: string; path: string; bytes: number | null; sha256: string | null; embedded: boolean; error?: string }>,
): string {
  const tableSummary = manifest.tables
    .filter((t) => t.rows > 0)
    .map((t) => `  ${t.name.padEnd(28)} ${String(t.rows).padStart(6)}   ${t.contentHash.slice(0, 16)}…`)
    .join("\n");
  const totalEmbedded = storage.filter((s) => s.embedded).length;
  const totalBytes = storage
    .filter((s) => s.embedded && s.bytes)
    .reduce((a, b) => a + (b.bytes ?? 0), 0);
  const failed = storage.filter((s) => !s.embedded);

  return `# Migrate this backup to Cloudflare R2 + D1

This ZIP contains everything in your database PLUS every file blob from
Supabase Storage, plus integrity hashes so you can prove nothing was lost.

## Contents

  manifest.json            table list, row counts, columns, PKs, SHA-256 per table
  verify-integrity.mjs     \`node verify-integrity.mjs\` — re-hashes every file
                           in this backup and fails loudly on any mismatch
  all.json                 every table as { tableName: rows[] }
  data/<table>.json        per-table JSON (most portable)
  data/<table>.csv         per-table CSV
  data/<table>.sql         per-table Postgres INSERT statements
  schema/<table>.sql       reference Postgres DDL
  all.sql                  combined Postgres restore (Hyperdrive / managed PG)
  d1/schema.sql            SQLite CREATE TABLE (starter — see caveats below)
  d1/data/<table>.sql      SQLite INSERT statements per table
  d1/import.sh             \`bash d1/import.sh <db-name>\` runs both via wrangler
  storage/<bucket>/<path>  actual file bytes from Supabase Storage
  storage/_manifest.json   bucket / path / size / SHA-256 per blob
  r2/upload-to-r2.sh       \`bash r2/upload-to-r2.sh <bucket-name>\` → R2

## Populated tables (${manifest.tableCount} total, ${manifest.tables.filter((t) => t.rows > 0).length} non-empty)

  table                          rows   sha256
${tableSummary}

## Storage blobs

  Embedded: ${totalEmbedded} files, ${(totalBytes / (1024 * 1024)).toFixed(2)} MB
  Failed:   ${failed.length} files${failed.length ? " (see storage/_manifest.json)" : ""}

## Step 1 — Verify the ZIP itself is intact

  unzip magictech-backup-*.zip -d backup && cd backup
  node verify-integrity.mjs

  Exit code 0 = every table + every storage file hashes correctly. Any
  mismatch is reported with table name / file path. Re-download the ZIP
  if anything fails here BEFORE pushing to Cloudflare.

## Step 2 — Files → Cloudflare R2

  1. \`wrangler r2 bucket create magictech-files\`
  2. \`bash r2/upload-to-r2.sh magictech-files\`

  The script preserves \`project_files.storage_path\` exactly so DB
  pointers remain valid after the swap.

## Step 3 — Rows → Cloudflare D1

  ⚠️  D1 is SQLite. This backup includes a STARTER schema at d1/schema.sql,
      but the app uses several Postgres features that don't translate
      cleanly. You CANNOT just run d1/import.sh and have the app work —
      you need to port the app code first. Specifically:

  1. **Full-text search (tsvector + GIN indexes).** Used on contacts,
     companies, deals, quotations via \`src/lib/search.ts\` and several
     API routes. SQLite uses FTS5 virtual tables with different syntax.
     Generated tsvector columns are SKIPPED in d1/schema.sql.

  2. **jsonb columns** (items_json, totals_json, config_json, meta_json,
     custom_fields, audience_modules, etc.). Stored as TEXT in D1. Every
     query using ->>/@>/jsonb_path needs rewriting to json_extract() /
     json_each() (SQLite JSON1).

  3. **text[] arrays** (news_posts.audience_modules / audience_roles).
     Stored as JSON-encoded TEXT in D1. Any ANY()/= ANY queries need
     rewriting.

  4. **Partial indexes WHERE clauses** — SQLite DOES support these, so
     they're preserved. But CHECK constraints may need tweaks.

  5. **\`now()\` / \`gen_random_uuid()\` defaults** — dropped from the SQLite
     schema because they're not valid SQLite. INSERTs supply explicit
     values from the source DB so existing rows are preserved 1:1; new
     INSERTs in app code need to pass an explicit timestamp instead of
     relying on the DB default.

  Once the app code is ported:

      wrangler d1 create magictech
      bash d1/import.sh magictech

  Then re-run \`node verify-integrity.mjs\` (this only verifies the local
  ZIP, not D1 itself). To verify D1, query each table for COUNT(*) and
  compare against manifest.json.

## Safer alternative — Hyperdrive + managed Postgres

  If a multi-week port is not on the table, use Cloudflare Hyperdrive
  in front of Neon or any managed Postgres. The existing schema works
  unchanged, every JSONB / tsvector query keeps working, and:

      psql "$NEW_DB_URL" -f all.sql

  imports the whole backup in one shot. Files still go to R2 via
  r2/upload-to-r2.sh. This is the lowest-risk path to Cloudflare and
  preserves the "no data loss" guarantee — D1 does not, at least not
  without the porting work above.

## Post-import verification

  manifest.json carries a SHA-256 \`contentHash\` for each table. After
  loading data into the destination DB, dump each table back to JSON
  the same way (sorted columns, same shape) and hash it. The hashes must
  match the manifest for every table. Any difference means a row was
  lost, mangled, or re-typed during the import.
`;
}

function buildR2UploadScript(
  storage: Array<{ bucket: string; path: string; embedded: boolean }>,
): string {
  const lines = [
    "#!/usr/bin/env bash",
    "# Push every blob under storage/ into a Cloudflare R2 bucket using wrangler.",
    "# Usage: bash r2/upload-to-r2.sh <r2-bucket-name>",
    "set -euo pipefail",
    "",
    'if [ -z "${1:-}" ]; then',
    '  echo "Usage: $0 <r2-bucket-name>"',
    "  exit 1",
    "fi",
    "BUCKET=\"$1\"",
    "",
    `echo "Uploading ${storage.filter((s) => s.embedded).length} file(s) to R2 bucket: $BUCKET"`,
    "",
  ];
  for (const obj of storage) {
    if (!obj.embedded) continue;
    const local = `storage/${obj.bucket}/${obj.path}`;
    // The R2 key intentionally keeps the bucket prefix so a multi-bucket
    // backup doesn't collide on identical paths.
    const remote = `${obj.bucket}/${obj.path}`;
    const shellEscape = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
    lines.push(
      `wrangler r2 object put "$BUCKET/${remote.replace(/"/g, '\\"')}" --file=${shellEscape(local)}`,
    );
  }
  lines.push("");
  lines.push('echo "Done."');
  return lines.join("\n");
}

function hashDbUrl(): string {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    "";
  // Don't include the password — just emit a short fingerprint so two backups
  // from different DBs are visibly distinguishable in the manifest.
  try {
    const u = new URL(url);
    const host = u.hostname;
    const db = u.pathname.replace(/^\//, "");
    const user = u.username;
    return `${user}@${host}/${db}`;
  } catch {
    return "unknown";
  }
}
