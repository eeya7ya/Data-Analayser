import { NextResponse } from "next/server";
import JSZip from "jszip";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

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

    for (const table of ordered) {
      const cols = (colsByTable.get(table) ?? []).sort(
        (a, b) => a.ordinal_position - b.ordinal_position,
      );
      const pkCols = (pksByTable.get(table) ?? []).map((p) => p.column_name);
      const colNames = cols.map((c) => c.column_name);

      const rows = (await q.unsafe(
        `select ${colNames.map(quoteIdent).join(", ")} from ${quoteIdent(table)}`,
      )) as Array<Record<string, unknown>>;

      const jsonText = JSON.stringify(rows, jsonReplacer, 2);
      zip.file(`data/${table}.json`, jsonText);

      const csvText = toCsv(colNames, rows);
      zip.file(`data/${table}.csv`, csvText);

      const insertSql = toInsertSql(table, cols, rows);
      zip.file(`data/${table}.sql`, insertSql);

      const ddl = synthesizeDdl(table, cols, pkCols);
      zip.file(`schema/${table}.sql`, ddl);

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
      });
    }

    allSqlChunks.push(`SET session_replication_role = DEFAULT;`);
    allSqlChunks.push(`COMMIT;`);
    zip.file("all.sql", allSqlChunks.join("\n"));
    zip.file("all.json", JSON.stringify(allJson, jsonReplacer, 2));
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
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
