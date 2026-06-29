import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { sql, ensureSchema, usingD1 } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/backup/restore
 *
 * Restores a backup produced by `GET /api/admin/backup`.
 *
 * Accepts either multipart/form-data with a `file` field or a raw ZIP body
 * (Content-Type: application/zip). Reads `manifest.json` from the ZIP for the
 * canonical table order, then for each table reads `data/<table>.json` and
 * upserts every row by primary key:
 *
 *   INSERT ... VALUES (...) ON CONFLICT (<pk>) DO UPDATE SET <every-non-pk>
 *
 * The operation is additive and idempotent:
 *   - Existing rows are overwritten with backup values.
 *   - Missing rows are inserted.
 *   - Rows present in the destination but absent from the backup are left
 *     alone — nothing is ever deleted by this endpoint.
 *
 * The schema must already exist on the destination. Visiting `/login` once or
 * running `npm run db:init` will bootstrap a fresh database.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    await ensureSchema();

    const buf = await readZipBytes(req);
    const zip = await JSZip.loadAsync(buf);

    const manifestFile = zip.file("manifest.json");
    if (!manifestFile) {
      return NextResponse.json(
        { ok: false, error: "manifest.json missing from archive" },
        { status: 400 },
      );
    }
    type ManifestTable = {
      name: string;
      rows: number;
      columns: Array<{ name: string; udt: string }>;
      primaryKey: string[];
    };
    type Manifest = {
      generatedAt: string;
      restoreOrder: string[];
      tables: ManifestTable[];
    };
    const manifest = JSON.parse(await manifestFile.async("string")) as Manifest;

    const q = sql();

    type Report = {
      table: string;
      inserted: number;
      updated: number;
      skipped: number;
      error?: string;
    };
    const report: Report[] = [];

    const d1 = usingD1();

    // Best-effort (Postgres only): defer FK enforcement so cross-table
    // dependencies in the backup don't block ingest. Requires
    // `pg_database_owner`-level rights; silently falls back to plain inserts
    // (which still work because the manifest preserves topological order) if
    // the role can't toggle it. D1 has no foreign-key enforcement here.
    let fkDeferred = false;
    if (!d1) {
      try {
        await q.unsafe(`set session session_replication_role = replica`);
        fkDeferred = true;
      } catch {
        fkDeferred = false;
      }
    }

    try {
      for (const tableName of manifest.restoreOrder) {
        const meta = manifest.tables.find((t) => t.name === tableName);
        if (!meta) continue;
        const file = zip.file(`data/${tableName}.json`);
        if (!file) {
          report.push({
            table: tableName,
            inserted: 0,
            updated: 0,
            skipped: 0,
            error: "data file missing",
          });
          continue;
        }
        const rows = JSON.parse(await file.async("string")) as Array<
          Record<string, unknown>
        >;
        if (rows.length === 0) {
          report.push({
            table: tableName,
            inserted: 0,
            updated: 0,
            skipped: 0,
          });
          continue;
        }

        const result = d1
          ? await restoreTableD1(q, meta, rows)
          : await restoreTable(q, meta, rows);
        report.push({ table: tableName, ...result });
      }
    } finally {
      if (fkDeferred) {
        await q
          .unsafe(`set session session_replication_role = default`)
          .catch(() => {});
      }
    }

    // Realign every serial / identity sequence so future inserts don't
    // collide with the restored maximum IDs (Postgres only — D1 derives the
    // next rowid from the restored max automatically).
    if (!d1) {
      await realignSequences(q, manifest.tables.map((t) => t.name));
    }

    const totals = report.reduce(
      (acc, r) => {
        acc.inserted += r.inserted;
        acc.updated += r.updated;
        acc.skipped += r.skipped;
        return acc;
      },
      { inserted: 0, updated: 0, skipped: 0 },
    );

    return NextResponse.json({
      ok: true,
      backupTakenAt: manifest.generatedAt,
      totals,
      tables: report,
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "FORBIDDEN" ? 403 : msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

async function readZipBytes(req: NextRequest): Promise<Buffer> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      throw new Error("missing 'file' field in multipart upload");
    }
    return Buffer.from(await file.arrayBuffer());
  }
  return Buffer.from(await req.arrayBuffer());
}

type SqlClient = ReturnType<typeof sql>;

async function restoreTable(
  q: SqlClient,
  meta: {
    name: string;
    columns: Array<{ name: string; udt: string }>;
    primaryKey: string[];
  },
  rows: Array<Record<string, unknown>>,
): Promise<{ inserted: number; updated: number; skipped: number; error?: string }> {
  const cols = meta.columns.map((c) => c.name);
  const colTypes = new Map(meta.columns.map((c) => [c.name, c.udt]));
  const pk = meta.primaryKey;

  const colList = cols.map(quoteIdent).join(", ");
  const updates = pk.length
    ? cols
        .filter((c) => !pk.includes(c))
        .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
        .join(", ")
    : "";

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const vals = cols.map((c) => sqlLiteral(row[c], colTypes.get(c) ?? "text"));
    let stmt: string;
    if (!pk.length) {
      // No PK — can't safely dedupe. Skip to avoid duplicating rows on re-run.
      skipped++;
      continue;
    }
    if (updates) {
      stmt =
        `INSERT INTO ${quoteIdent(meta.name)} (${colList}) ` +
        `VALUES (${vals.join(", ")}) ` +
        `ON CONFLICT (${pk.map(quoteIdent).join(", ")}) DO UPDATE SET ${updates} ` +
        `RETURNING (xmax = 0) AS inserted`;
    } else {
      // PK exists but every column is part of it — only INSERT-or-skip makes sense.
      stmt =
        `INSERT INTO ${quoteIdent(meta.name)} (${colList}) ` +
        `VALUES (${vals.join(", ")}) ` +
        `ON CONFLICT (${pk.map(quoteIdent).join(", ")}) DO NOTHING ` +
        `RETURNING (xmax = 0) AS inserted`;
    }
    try {
      const res = (await q.unsafe(stmt)) as Array<{ inserted: boolean }>;
      if (res.length === 0) skipped++;
      else if (res[0].inserted) inserted++;
      else updated++;
    } catch (err) {
      return {
        inserted,
        updated,
        skipped,
        error: `row failed: ${(err as Error).message}`,
      };
    }
  }

  return { inserted, updated, skipped };
}

/**
 * D1/SQLite restore of one table: upsert every row by primary key via
 * INSERT OR REPLACE. Values are bound as scalar params (objects/arrays → JSON
 * text, booleans → 0/1) so quoting/casts are never an issue. Reports all rows
 * as "inserted" — D1's INSERT OR REPLACE doesn't distinguish insert vs update
 * without an extra probe per row.
 */
async function restoreTableD1(
  q: SqlClient,
  meta: {
    name: string;
    columns: Array<{ name: string; udt: string }>;
    primaryKey: string[];
  },
  rows: Array<Record<string, unknown>>,
): Promise<{ inserted: number; updated: number; skipped: number; error?: string }> {
  if (meta.primaryKey.length === 0) {
    // No PK — INSERT OR REPLACE can't dedupe; skip to avoid duplicating rows.
    return { inserted: 0, updated: 0, skipped: rows.length };
  }
  const cols = meta.columns.map((c) => c.name);
  const colList = cols.map(quoteIdent).join(", ");
  const placeholders = cols.map(() => "?").join(", ");
  const stmt = `INSERT OR REPLACE INTO ${quoteIdent(meta.name)} (${colList}) VALUES (${placeholders})`;

  let inserted = 0;
  for (const row of rows) {
    const vals = cols.map((c) => toD1Value(row[c]));
    try {
      await q.unsafe(stmt, vals);
      inserted++;
    } catch (err) {
      return {
        inserted,
        updated: 0,
        skipped: 0,
        error: `row failed: ${(err as Error).message}`,
      };
    }
  }
  return { inserted, updated: 0, skipped: 0 };
}

/** Coerce a backup JSON value to a D1-safe scalar bind param. */
function toD1Value(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

async function realignSequences(q: SqlClient, tables: string[]): Promise<void> {
  // For each integer column on each table, if it's backed by a sequence,
  // bump the sequence to max(col)+1 so freshly-restored max IDs don't clash
  // with new inserts. Best-effort — failures are non-fatal.
  for (const table of tables) {
    type Seq = { column_name: string; seq: string | null };
    const seqs = (await q.unsafe(
      `select column_name, pg_get_serial_sequence($1, column_name) as seq
       from information_schema.columns
       where table_schema = 'public' and table_name = $1`,
      [table],
    )) as Seq[];
    for (const s of seqs) {
      if (!s.seq) continue;
      try {
        await q.unsafe(
          `select setval($1::regclass,
             coalesce((select max(${quoteIdent(s.column_name)}) from ${quoteIdent(
            table,
          )}), 0) + 1, false)`,
          [s.seq],
        );
      } catch {
        // ignore — column may have non-numeric type or table may be empty
      }
    }
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sqlLiteral(v: unknown, udt: string): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "NULL";
    return String(v);
  }
  if (typeof v === "bigint") return v.toString();
  // JSON round-trips arrays/objects as plain values; coerce based on udt.
  if (typeof v === "object") {
    if (Array.isArray(v) && udt !== "jsonb" && udt !== "json") {
      // Postgres array literal — works for primitive arrays.
      const inner = v
        .map((x) =>
          x === null
            ? "NULL"
            : typeof x === "string"
              ? `"${x.replace(/"/g, '\\"')}"`
              : String(x),
        )
        .join(",");
      return `'{${inner}}'`;
    }
    const cast = udt === "jsonb" ? "::jsonb" : udt === "json" ? "::json" : "";
    return `${pgString(JSON.stringify(v))}${cast}`;
  }
  const s = String(v);
  if (udt === "timestamptz" || udt === "timestamp" || udt === "timestamptz_array") {
    return `${pgString(s)}::${udt}`;
  }
  return pgString(s);
}

function pgString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
