/**
 * Build a restore-compatible snapshot of the entire Postgres (`public` schema)
 * database, in memory, as a ZIP buffer.
 *
 * Why this exists
 * ───────────────
 * Project FILES already live in Cloudflare R2 (uploads land there directly;
 * see src/lib/storage.ts and src/lib/file-backup.ts). The database ROWS,
 * however, live only in Supabase Postgres — that's the one piece of app state
 * with a single point of dependence on Supabase. This module dumps every table
 * to JSON and packages it as a ZIP whose layout is byte-for-byte what the
 * existing restore endpoint (`POST /api/admin/backup/restore`) already knows
 * how to ingest:
 *
 *   manifest.json        { generatedAt, restoreOrder, tables:[{name,rows,
 *                          columns:[{name,udt,...}], primaryKey, contentHash}] }
 *   data/<table>.json    JSON array of every row in that table
 *   all.json             { <table>: rows[] } convenience roll-up
 *
 * The "one-click backup to R2" route uploads this ZIP straight into the R2
 * bucket, so R2 holds a complete, self-contained copy of the database that can
 * be downloaded and fed back through Restore without Supabase being reachable.
 *
 * This is intentionally JSON-only: no per-table CSV/SQL or storage blobs are
 * embedded, because the file blobs already live in R2 as the primary store and
 * re-embedding them here would just duplicate bytes. The full downloadable
 * backup (GET /api/admin/backup) is still the place for those extra artifacts.
 */

import JSZip from "jszip";
import { createHash } from "node:crypto";
import { sql } from "./db";

type SqlClient = ReturnType<typeof sql>;

export type SnapshotTableMeta = {
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
  /** SHA-256 of the canonical JSON serialization of all rows. */
  contentHash: string;
};

export type SnapshotManifest = {
  generatedAt: string;
  schema: "public";
  tableCount: number;
  totalRows: number;
  restoreOrder: string[];
  tables: SnapshotTableMeta[];
};

export type DbSnapshot = {
  /** The restore-compatible ZIP. */
  buffer: Buffer;
  manifest: SnapshotManifest;
};

/**
 * Read the whole `public` schema and produce a restore-compatible ZIP plus its
 * manifest. Read-only — no row or schema state is mutated.
 */
export async function buildDbSnapshotZip(q: SqlClient): Promise<DbSnapshot> {
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

  const manifest: SnapshotManifest = {
    generatedAt: new Date().toISOString(),
    schema: "public",
    tableCount: ordered.length,
    totalRows: 0,
    restoreOrder: ordered,
    tables: [],
  };

  const zip = new JSZip();
  const allJson: Record<string, Array<Record<string, unknown>>> = {};

  for (const table of ordered) {
    const cols = (colsByTable.get(table) ?? []).sort(
      (a, b) => a.ordinal_position - b.ordinal_position,
    );
    const pkCols = (pksByTable.get(table) ?? []).map((p) => p.column_name);
    const colNames = cols.map((c) => c.column_name);

    const rows = (await q.unsafe(
      `select ${colNames.map(quoteIdent).join(", ")} from ${quoteIdent(table)}`,
    )) as Array<Record<string, unknown>>;

    const contentHash = createHash("sha256")
      .update(canonicalStringify(rows))
      .digest("hex");

    zip.file(`data/${table}.json`, JSON.stringify(rows, jsonReplacer, 2));
    allJson[table] = rows;
    manifest.totalRows += rows.length;

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

  zip.file("all.json", JSON.stringify(allJson, jsonReplacer, 2));
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file(
    "README.txt",
    [
      "MagicTech database snapshot (Cloudflare R2)",
      "===========================================",
      `Generated: ${manifest.generatedAt}`,
      `Tables: ${manifest.tableCount}  Rows: ${manifest.totalRows}`,
      "",
      "This ZIP is a complete, restore-ready copy of every row in the",
      "database. To restore: download it from R2, then use the",
      "Admin → Database → 'Restore from backup (.zip)' control. The restore",
      "is additive — it upserts every row by primary key and never deletes.",
      "",
      "File blobs (PDFs, BOQs, photos) are NOT inside this ZIP: they already",
      "live in the same R2 bucket under project-files/<path> as the primary",
      "store, so they don't need re-embedding here.",
    ].join("\n"),
  );

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return { buffer, manifest };
}

// ─── helpers (kept local so this module is self-contained) ───────────────────

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

/**
 * Canonical JSON: sorted keys at every level, no whitespace, so identical data
 * always hashes identically regardless of column ordering.
 */
function canonicalStringify(value: unknown): string {
  const replacer = (_k: string, v: unknown): unknown => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Date) return v.toISOString();
    if (v instanceof Uint8Array) return `\\x${Buffer.from(v).toString("hex")}`;
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
