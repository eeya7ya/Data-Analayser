import { NextResponse } from "next/server";
import { sql as getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { d1Query, isD1Configured } from "@/lib/db-d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — Vercel Pro

/**
 * POST /api/admin/d1-migrate-data
 *
 * Admin-only. Copies every row from every public-schema table in the
 * Supabase Postgres database into the Cloudflare D1 database.
 *
 * Safe to re-run: uses INSERT OR REPLACE so duplicate rows are overwritten
 * rather than erroring. tsvector / FTS columns are skipped automatically
 * (they don't exist in the D1 schema).
 *
 * Returns:
 *   { tables: Array<{ name, rows, migrated, errors }>, totalMigrated, totalErrors }
 */
export async function POST() {
  try {
    await requireAdmin();

    if (!isD1Configured()) {
      return NextResponse.json(
        { error: "D1 env vars not set. Configure CLOUDFLARE_* in Vercel." },
        { status: 503 },
      );
    }

    const q = getDb();

    // 1. Get all public tables in alphabetical order.
    type TableRow = { table_name: string };
    const tablesRaw = (await q`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `) as TableRow[];

    // 2. Get column metadata so we know types and can skip tsvector.
    type ColRow = {
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      ordinal_position: number;
    };
    const colsMeta = (await q`
      SELECT table_name, column_name, data_type, udt_name, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `) as ColRow[];

    // Group columns by table.
    const colsByTable = new Map<string, ColRow[]>();
    for (const c of colsMeta) {
      const list = colsByTable.get(c.table_name) ?? [];
      list.push(c);
      colsByTable.set(c.table_name, list);
    }

    // 3. For each table, read from Supabase and write to D1.
    type TableResult = {
      name: string;
      pgRows: number;
      migrated: number;
      errors: string[];
    };
    const results: TableResult[] = [];

    for (const { table_name: table } of tablesRaw) {
      const allCols = colsByTable.get(table) ?? [];
      // Keep only columns that have a D1 equivalent (drop tsvector etc.).
      const keep = allCols.filter((c) => d1TypeFor(c.udt_name, c.data_type) !== null);

      if (keep.length === 0) {
        results.push({ name: table, pgRows: 0, migrated: 0, errors: ["all columns skipped"] });
        continue;
      }

      // Verify the table actually exists in D1 before trying to write.
      try {
        await d1Query(`SELECT 1 FROM "${table}" LIMIT 1`);
      } catch {
        results.push({ name: table, pgRows: 0, migrated: 0, errors: ["table missing in D1 — apply schema first"] });
        continue;
      }

      // Fetch all rows from Supabase.  The identifier is safe: it comes from
      // information_schema, not from user input.
      let rows: Record<string, unknown>[];
      try {
        const colList = keep.map((c) => `"${c.column_name}"`).join(", ");
        rows = (await q.unsafe(`SELECT ${colList} FROM public."${table}"`)) as Record<string, unknown>[];
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ name: table, pgRows: 0, migrated: 0, errors: [msg] });
        continue;
      }

      if (rows.length === 0) {
        results.push({ name: table, pgRows: 0, migrated: 0, errors: [] });
        continue;
      }

      // Build parameterised INSERT OR REPLACE statements with multiple rows
      // per statement. D1's parameter limit appears to be ~100, so we compute
      // batch size dynamically: rows_per_batch = floor(MAX_PARAMS / columns).
      // Tables with many columns get smaller batches; narrow tables get larger ones.
      const colNames = keep.map((c) => `"${c.column_name}"`).join(", ");
      const singleRowSql = `INSERT OR REPLACE INTO "${table}" (${colNames}) VALUES (${keep.map(() => "?").join(", ")})`;
      const MAX_PARAMS = 90; // Safe margin under D1's ~100 limit
      const rowsPerStmt = Math.max(1, Math.floor(MAX_PARAMS / keep.length));

      const tableErrors: string[] = [];
      let migrated = 0;

      // For a single oversized row (D1 row cap ~1MB), iteratively replace the
      // largest string/JSON column with a small truncation marker until the row
      // fits. Each attempt picks the largest remaining column, so we only lose
      // as much data as necessary.
      async function migrateRowWithTruncation(row: Record<string, unknown>, startIdx: number): Promise<void> {
        const workingParams = keep.map((c) => toD1Param(row[c.column_name], c.udt_name));
        const truncatedCols: string[] = [];

        for (let attempt = 0; attempt < keep.length; attempt++) {
          // Find the largest remaining untruncated string column.
          let largestIdx = -1;
          let largestSize = 0;
          for (let idx = 0; idx < workingParams.length; idx++) {
            const v = workingParams[idx];
            if (typeof v === "string" && v.length > largestSize && !v.startsWith('{"__truncated_during_migration__"')) {
              largestSize = v.length;
              largestIdx = idx;
            }
          }

          if (largestIdx === -1) {
            tableErrors.push(`row ${startIdx}: nothing left to truncate (already truncated: ${truncatedCols.join(", ")})`);
            return;
          }

          const colName = keep[largestIdx].column_name;
          const origValue = workingParams[largestIdx] as string;
          workingParams[largestIdx] = JSON.stringify({
            __truncated_during_migration__: true,
            original_size_bytes: origValue.length,
            column: colName,
          });
          truncatedCols.push(`${colName}(${origValue.length}b)`);

          try {
            await d1Query(singleRowSql, workingParams);
            migrated++;
            tableErrors.push(`row ${startIdx}: oversized column(s) replaced with truncation marker: ${truncatedCols.join(", ")}`);
            return;
          } catch (retryErr) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            if (!/SQLITE_TOOBIG|too big/i.test(retryMsg)) {
              tableErrors.push(`row ${startIdx}: ${retryMsg.slice(0, 200)} (after truncating: ${truncatedCols.join(", ")})`);
              return;
            }
            // Still too big — loop again to truncate next largest column.
          }
        }

        tableErrors.push(`row ${startIdx}: still too big after truncating every column: ${truncatedCols.join(", ")}`);
      }

      // Try to migrate chunk; if it fails, recursively split in half. When down
      // to a single row that still fails with TOOBIG, fall back to truncation.
      async function migrateChunk(chunkRows: Record<string, unknown>[], startIdx: number): Promise<void> {
        if (chunkRows.length === 0) return;

        const valueClauses = chunkRows.map(() => `(${keep.map(() => "?").join(", ")})`).join(", ");
        const multiRowSql = `INSERT OR REPLACE INTO "${table}" (${colNames}) VALUES ${valueClauses}`;
        const allParams = chunkRows.flatMap((row) =>
          keep.map((c) => toD1Param(row[c.column_name], c.udt_name)),
        );

        try {
          await d1Query(multiRowSql, allParams);
          migrated += chunkRows.length;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);

          if (chunkRows.length === 1) {
            if (/SQLITE_TOOBIG|too big/i.test(msg)) {
              await migrateRowWithTruncation(chunkRows[0], startIdx);
              return;
            }
            tableErrors.push(`row ${startIdx}: ${msg.slice(0, 200)}`);
            return;
          }

          const mid = Math.ceil(chunkRows.length / 2);
          const left = chunkRows.slice(0, mid);
          const right = chunkRows.slice(mid);
          await migrateChunk(left, startIdx);
          await migrateChunk(right, startIdx + left.length);
        }
      }

      for (let i = 0; i < rows.length; i += rowsPerStmt) {
        const chunk = rows.slice(i, i + rowsPerStmt);
        await migrateChunk(chunk, i);
      }

      results.push({
        name: table,
        pgRows: rows.length,
        migrated,
        errors: tableErrors,
      });
    }

    const totalMigrated = results.reduce((a, r) => a + r.migrated, 0);
    const totalErrors = results.reduce((a, r) => a + r.errors.length, 0);

    return NextResponse.json({ tables: results, totalMigrated, totalErrors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// ─── type helpers ────────────────────────────────────────────────────────────

/** Returns null for columns that have no D1 equivalent (e.g. tsvector). */
function d1TypeFor(udt: string, dataType: string): string | null {
  const u = udt.toLowerCase();
  const d = dataType.toLowerCase();
  if (u === "tsvector") return null;
  if (d === "user-defined" && u === "tsvector") return null;
  return "TEXT"; // placeholder — value doesn't matter, null = skip
}

/** Convert a Postgres JS value to a D1-safe scalar param. */
function toD1Param(v: unknown, udt: string): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) {
    // bytea — store as hex string; D1 has no native BLOB via REST params
    return Buffer.from(v).toString("hex");
  }
  if (typeof v === "object") {
    // jsonb, json, text[], _text, etc.
    return JSON.stringify(v);
  }
  void udt; // udt available for future type-specific handling
  return String(v);
}
