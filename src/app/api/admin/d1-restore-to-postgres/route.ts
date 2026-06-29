import { NextResponse } from "next/server";
import { sql as getDb, ensureSchema } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { d1Query, isD1Configured } from "@/lib/db-d1";
import { resolveR2Overflow } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — Vercel Pro

/**
 * POST /api/admin/d1-restore-to-postgres
 *
 * The REVERSE of d1-migrate-data: copies every row from Cloudflare D1 back
 * into the current Postgres (`DATABASE_URL`) — used to bring the app back
 * online on a fresh Postgres (e.g. Neon) after the original Supabase project
 * was deleted. Runs on Vercel, where Cloudflare's API is reachable.
 *
 * Auth: a valid admin session (JWT — works even though the new Postgres
 * `users` table is still empty, because auth doesn't hit the DB), OR a
 * `?secret=` query param matching the RESTORE_SECRET env var (fallback for
 * when no admin session exists yet). If RESTORE_SECRET is unset, only the
 * admin session is accepted.
 *
 * Idempotent: every write is INSERT … ON CONFLICT DO UPDATE, so re-running
 * overwrites rather than duplicating. Nothing is ever dropped.
 *
 * Required env (set in Vercel): CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID,
 * CLOUDFLARE_API_TOKEN. Optional (only if rows overflowed to R2):
 * CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY.
 */
/**
 * GET is supported for convenience so the restore can be triggered by simply
 * pasting the URL (with ?secret=…) into a browser — no terminal needed. It
 * runs the exact same one-shot restore as POST.
 */
export async function GET(req: Request) {
  return runRestore(req);
}

export async function POST(req: Request) {
  return runRestore(req);
}

async function runRestore(req: Request) {
  let cleanup: (() => Promise<void>) | null = null;
  try {
    await assertAuthorized(req);

    if (!isD1Configured()) {
      return NextResponse.json(
        {
          error:
            "D1 source not configured. Set CLOUDFLARE_ACCOUNT_ID, " +
            "CLOUDFLARE_D1_DATABASE_ID and CLOUDFLARE_API_TOKEN in Vercel, then redeploy.",
        },
        { status: 503 },
      );
    }

    const url = new URL(req.url);
    const probe = url.searchParams.get("probe") === "1";
    const onlyTable = url.searchParams.get("table");
    const q = getDb();

    // Instant connectivity probe — no writes, returns in ~1s. Use this to see
    // whether D1 and Neon are reachable and how many rows each already has.
    if (probe) {
      const out: Record<string, unknown> = { probe: true };
      try {
        const dq = await d1Query<{ c: number }>(`SELECT COUNT(*) AS c FROM "quotations"`);
        out.d1 = { reachable: true, quotations: Number(dq.results[0]?.c ?? 0) };
      } catch (e) {
        out.d1 = { reachable: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 160) };
      }
      try {
        const pt = (await q`select count(*)::int c from information_schema.tables
                            where table_schema='public' and table_type='BASE TABLE'`) as Array<{ c: number }>;
        let pqCount = -1;
        try {
          const pq = (await q`select count(*)::int c from quotations`) as Array<{ c: number }>;
          pqCount = pq[0]?.c ?? -1;
        } catch {
          /* table may not exist yet */
        }
        out.neon = { reachable: true, tables: pt[0]?.c ?? 0, quotations: pqCount };
      } catch (e) {
        out.neon = { reachable: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 160) };
      }
      return NextResponse.json(out);
    }

    // Build the schema only if it's actually missing — on a warm DB this saves
    // the whole DDL/migration pass, which otherwise can eat the function's time
    // budget before any data is copied.
    const reg = (await q`select to_regclass('public.quotations') as t`) as Array<{ t: string | null }>;
    if (!reg[0]?.t) await ensureSchema();

    const { tables, colsByTable, pkByTable, fks } = await readPgSchema(q);
    const ordered = topoSort(tables, fks).filter((t) => !onlyTable || t === onlyTable);

    const PAGE = 500;
    const results: TableResult[] = [];
    let overflowFetched = 0;
    let overflowErrors = 0;

    // One reserved connection for the whole load, with FK enforcement disabled
    // on it, so circular references (folders <-> companies <-> projects <->
    // quotations) load regardless of insertion order. Falls back to the pooled
    // client if the role isn't allowed to set session_replication_role.
    let conn = q;
    let fkDisabled = false;
    try {
      const reserved = await q.reserve();
      try {
        await reserved.unsafe("SET session_replication_role = replica");
        conn = reserved as unknown as typeof q;
        fkDisabled = true;
        cleanup = async () => {
          try {
            await reserved.unsafe("SET session_replication_role = DEFAULT");
          } catch {
            /* ignore */
          }
          reserved.release();
        };
      } catch {
        reserved.release();
      }
    } catch {
      /* reserve() unavailable — use the pooled client and rely on re-runs */
    }

    for (const table of ordered) {
      const pgCols = colsByTable.get(table) ?? [];
      const udtByCol = new Map(pgCols.map((c) => [c.name, c.udt]));
      const pk = pkByTable.get(table) ?? [];

      // Skip tables that don't exist in D1 (e.g. FTS-only artefacts).
      const exists = await d1Query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        [table],
      );
      if (exists.results.length === 0) {
        results.push({ name: table, d1Rows: 0, loaded: 0, errors: ["not in D1 (skipped)"] });
        continue;
      }

      let d1Rows = 0;
      let loaded = 0;
      const errors: string[] = [];
      let offset = 0;

      // Column layout + per-column cast/convert, resolved once from the first
      // row we see (D1 returns the same columns for every row of a table).
      let cols: string[] | null = null;
      const convs: Array<(raw: unknown) => unknown> = [];
      const phs: Array<(n: number) => string> = [];
      let colIdents = "";
      let conflict = "";

      let batch: unknown[][] = [];
      const flushBatch = async () => {
        if (!cols || cols.length === 0 || batch.length === 0) return;
        const m = cols.length;
        const valuesSql: string[] = [];
        const params: unknown[] = [];
        let n = 1;
        for (const rowVals of batch) {
          const cells: string[] = [];
          for (let i = 0; i < m; i++) {
            cells.push(phs[i](n));
            params.push(rowVals[i]);
            n++;
          }
          valuesSql.push(`(${cells.join(", ")})`);
        }
        const stmt = `INSERT INTO "${table}" (${colIdents}) VALUES ${valuesSql.join(", ")} ${conflict}`;
        try {
          await conn.unsafe(stmt, params as never[]);
          loaded += batch.length;
        } catch {
          // One bad row shouldn't sink the batch — retry each row alone.
          for (const rowVals of batch) {
            const cells: string[] = [];
            const p: unknown[] = [];
            for (let i = 0; i < m; i++) {
              cells.push(phs[i](i + 1));
              p.push(rowVals[i]);
            }
            const one = `INSERT INTO "${table}" (${colIdents}) VALUES (${cells.join(", ")}) ${conflict}`;
            try {
              await conn.unsafe(one, p as never[]);
              loaded++;
            } catch (e2) {
              errors.push((e2 instanceof Error ? e2.message : String(e2)).slice(0, 180));
            }
          }
        }
        batch = [];
      };

      for (;;) {
        const res = await d1Query<Record<string, unknown>>(
          `SELECT * FROM "${table}" LIMIT ${PAGE} OFFSET ${offset}`,
        );
        const rows = res.results ?? [];
        if (rows.length === 0) break;

        for (const row of rows) {
          d1Rows++;

          if (!cols) {
            cols = pgCols.map((c) => c.name).filter((c) => c in row);
            colIdents = cols.map((c) => `"${c}"`).join(", ");
            for (const c of cols) {
              const info = castInfo(udtByCol.get(c));
              convs.push(info.conv);
              phs.push(info.ph);
            }
            const updates = cols
              .filter((c) => !pk.includes(c))
              .map((c) => `"${c}" = EXCLUDED."${c}"`)
              .join(", ");
            conflict =
              pk.length > 0
                ? `ON CONFLICT (${pk.map((c) => `"${c}"`).join(", ")}) ${
                    updates ? `DO UPDATE SET ${updates}` : "DO NOTHING"
                  }`
                : "";
          }
          if (cols.length === 0) continue;

          const rowVals: unknown[] = [];
          for (let i = 0; i < cols.length; i++) {
            const c = cols[i];
            let v = row[c];
            if (typeof v === "string" && v.includes('"__r2_overflow__"')) {
              try {
                v = await resolveR2Overflow(v);
                overflowFetched++;
              } catch (e) {
                overflowErrors++;
                errors.push(
                  `pk=${String(row[pk[0]] ?? "?")} col=${c}: overflow rehydrate failed: ${
                    e instanceof Error ? e.message : String(e)
                  }`,
                );
              }
            }
            rowVals.push(convs[i](v));
          }
          batch.push(rowVals);
          // Cap by row count and by total bind params (Postgres limit 65535).
          if (batch.length >= 200 || batch.length * cols.length >= 40000) {
            await flushBatch();
          }
        }

        if (rows.length < PAGE) break;
        offset += PAGE;
      }
      await flushBatch();

      // Reset the serial sequence so future inserts don't collide.
      if (pk.length === 1 && pk[0] === "id" && loaded > 0) {
        try {
          await conn.unsafe(
            `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'),
                    GREATEST((SELECT COALESCE(MAX(id), 1) FROM "${table}"), 1))`,
          );
        } catch {
          /* no serial sequence — fine */
        }
      }

      results.push({ name: table, d1Rows, loaded, errors });
    }

    const totalLoaded = results.reduce((a, r) => a + r.loaded, 0);
    const totalErrors = results.reduce((a, r) => a + r.errors.length, 0);

    return NextResponse.json({
      ok: true,
      tablesProcessed: results.length,
      totalLoaded,
      totalErrors,
      overflowFetched,
      overflowErrors,
      fkDisabled,
      tables: results,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  } finally {
    if (cleanup) await cleanup();
  }
}

// ─── auth ─────────────────────────────────────────────────────────────────────

async function assertAuthorized(req: Request): Promise<void> {
  const secret = process.env.RESTORE_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const provided = url.searchParams.get("secret") ?? req.headers.get("x-restore-secret");
    if (provided && provided === secret) return;
  }
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  if (user.role !== "admin") throw new Error("FORBIDDEN");
}

// ─── types ────────────────────────────────────────────────────────────────────

type TableResult = { name: string; d1Rows: number; loaded: number; errors: string[] };
type PgCol = { name: string; udt: string };

// ─── value conversion: D1 scalar → Postgres value for a column's type ─────────

function pgCastFor(udt: string | undefined): string | null {
  const u = (udt || "").toLowerCase();
  if (u === "bool") return "boolean";
  if (u === "json") return "json";
  if (u === "jsonb") return "jsonb";
  if (u === "bytea") return "bytea-hex";
  if (u === "timestamptz") return "timestamptz";
  if (u === "timestamp") return "timestamp";
  if (u === "date") return "date";
  if (u === "uuid") return "uuid";
  if (u === "numeric") return "numeric";
  if (u.startsWith("_")) return "array";
  return null;
}

/**
 * For a column's Postgres type, returns:
 *   - ph(n):  the positional placeholder embedding the right cast
 *   - conv(raw): the D1 scalar converted to the value bound to that placeholder
 * Resolved once per column, then reused for every row in the batch.
 */
function castInfo(udt: string | undefined): {
  ph: (n: number) => string;
  conv: (raw: unknown) => unknown;
} {
  const cast = pgCastFor(udt);
  const nullable =
    (fn: (raw: unknown) => unknown) =>
    (raw: unknown): unknown =>
      raw === null || raw === undefined ? null : fn(raw);

  switch (cast) {
    case "boolean":
      return {
        ph: (n) => `$${n}::boolean`,
        conv: nullable((v) => v === 1 || v === "1" || v === true || v === "true"),
      };
    case "json":
    case "jsonb":
      return {
        ph: (n) => `$${n}::${cast}`,
        conv: nullable((v) => (typeof v === "string" ? v : JSON.stringify(v))),
      };
    case "bytea-hex":
      return { ph: (n) => `decode($${n}, 'hex')`, conv: nullable((v) => String(v)) };
    case "array": {
      const elem = (udt || "_text").replace(/^_/, "");
      return {
        ph: (n) => `$${n}::${elem}[]`,
        conv: nullable((v) => {
          let arr: unknown = v;
          if (typeof v === "string") {
            try {
              arr = JSON.parse(v);
            } catch {
              arr = [v];
            }
          }
          if (!Array.isArray(arr)) arr = arr == null ? [] : [arr];
          return arr;
        }),
      };
    }
    case "timestamptz":
    case "timestamp":
    case "date":
      return { ph: (n) => `$${n}::${cast}`, conv: nullable((v) => String(v)) };
    case "uuid":
      return { ph: (n) => `$${n}::uuid`, conv: nullable((v) => String(v)) };
    case "numeric":
      return { ph: (n) => `$${n}::numeric`, conv: nullable((v) => v) };
    default:
      return { ph: (n) => `$${n}`, conv: nullable((v) => v) };
  }
}

// ─── Postgres schema introspection ───────────────────────────────────────────

async function readPgSchema(q: ReturnType<typeof getDb>): Promise<{
  tables: string[];
  colsByTable: Map<string, PgCol[]>;
  pkByTable: Map<string, string[]>;
  fks: Array<{ table_name: string; referenced_table: string }>;
}> {
  const cols = (await q`
    select table_name, column_name, udt_name, ordinal_position
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position
  `) as Array<{ table_name: string; column_name: string; udt_name: string }>;

  const pks = (await q`
    select kcu.table_name, kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema = kcu.table_schema
    where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY'
    order by kcu.table_name, kcu.ordinal_position
  `) as Array<{ table_name: string; column_name: string }>;

  const tablesRaw = (await q`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `) as Array<{ table_name: string }>;

  const fks = (await q`
    select tc.table_name, ccu.table_name as referenced_table
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name
     and tc.table_schema = ccu.table_schema
    where tc.table_schema = 'public' and tc.constraint_type = 'FOREIGN KEY'
  `) as Array<{ table_name: string; referenced_table: string }>;

  const colsByTable = new Map<string, PgCol[]>();
  for (const c of cols) {
    const list = colsByTable.get(c.table_name) ?? [];
    list.push({ name: c.column_name, udt: c.udt_name });
    colsByTable.set(c.table_name, list);
  }
  const pkByTable = new Map<string, string[]>();
  for (const p of pks) {
    const list = pkByTable.get(p.table_name) ?? [];
    list.push(p.column_name);
    pkByTable.set(p.table_name, list);
  }
  const tables = tablesRaw.map((t) => t.table_name);
  return { tables, colsByTable, pkByTable, fks };
}

function topoSort(
  tables: string[],
  fks: Array<{ table_name: string; referenced_table: string }>,
): string[] {
  const deps = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
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
      if (Array.from(deps.get(t)!).every((d) => seen.has(d))) {
        out.push(t);
        seen.add(t);
        remaining.delete(t);
        progress = true;
      }
    }
    if (!progress) {
      for (const t of Array.from(remaining)) out.push(t);
      break;
    }
  }
  return out;
}
