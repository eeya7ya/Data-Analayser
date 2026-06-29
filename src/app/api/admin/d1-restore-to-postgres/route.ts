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

    // Make sure the Postgres schema exists before we load into it.
    await ensureSchema();
    const q = getDb();

    const { tables, colsByTable, pkByTable, fks } = await readPgSchema(q);
    const ordered = topoSort(tables, fks);

    const PAGE = 500;
    const results: TableResult[] = [];
    let overflowFetched = 0;
    let overflowErrors = 0;

    for (const table of ordered) {
      const pgCols = colsByTable.get(table) ?? [];
      const pgColNames = new Set(pgCols.map((c) => c.name));
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

      for (;;) {
        const res = await d1Query<Record<string, unknown>>(
          `SELECT * FROM "${table}" LIMIT ${PAGE} OFFSET ${offset}`,
        );
        const rows = res.results ?? [];
        if (rows.length === 0) break;

        for (const row of rows) {
          d1Rows++;
          const cols = Object.keys(row).filter((c) => pgColNames.has(c));
          if (cols.length === 0) continue;

          // Rehydrate any R2-overflowed cells.
          for (const c of cols) {
            const v = row[c];
            if (typeof v === "string" && v.includes('"__r2_overflow__"')) {
              try {
                row[c] = await resolveR2Overflow(v);
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
          }

          const placeholders: string[] = [];
          const values: unknown[] = [];
          cols.forEach((c, i) => {
            const { placeholder, value } = buildParam(row[c], udtByCol.get(c), i + 1);
            placeholders.push(placeholder);
            values.push(value);
          });

          const colIdents = cols.map((c) => `"${c}"`).join(", ");
          const updates = cols
            .filter((c) => !pk.includes(c))
            .map((c) => `"${c}" = EXCLUDED."${c}"`)
            .join(", ");
          const conflict =
            pk.length > 0
              ? `ON CONFLICT (${pk.map((c) => `"${c}"`).join(", ")}) ${
                  updates ? `DO UPDATE SET ${updates}` : "DO NOTHING"
                }`
              : "";
          const stmt = `INSERT INTO "${table}" (${colIdents}) VALUES (${placeholders.join(
            ", ",
          )}) ${conflict}`;

          try {
            await q.unsafe(stmt, values as never[]);
            loaded++;
          } catch (e) {
            errors.push(
              `pk=${String(row[pk[0]] ?? "?")}: ${
                (e instanceof Error ? e.message : String(e)).slice(0, 180)
              }`,
            );
          }
        }

        if (rows.length < PAGE) break;
        offset += PAGE;
      }

      // Reset the serial sequence so future inserts don't collide.
      if (pk.length === 1 && pk[0] === "id" && loaded > 0) {
        try {
          await q.unsafe(
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
      tables: results,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
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

function buildParam(
  rawValue: unknown,
  udt: string | undefined,
  idx: number,
): { placeholder: string; value: unknown } {
  const cast = pgCastFor(udt);
  if (rawValue === null || rawValue === undefined) {
    return { placeholder: `$${idx}`, value: null };
  }
  switch (cast) {
    case "boolean": {
      const truthy =
        rawValue === 1 || rawValue === "1" || rawValue === true || rawValue === "true";
      return { placeholder: `$${idx}::boolean`, value: truthy };
    }
    case "json":
    case "jsonb": {
      const text = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
      return { placeholder: `$${idx}::${cast}`, value: text };
    }
    case "bytea-hex":
      return { placeholder: `decode($${idx}, 'hex')`, value: String(rawValue) };
    case "array": {
      let arr: unknown = rawValue;
      if (typeof rawValue === "string") {
        try {
          arr = JSON.parse(rawValue);
        } catch {
          arr = [rawValue];
        }
      }
      if (!Array.isArray(arr)) arr = arr == null ? [] : [arr];
      const elem = (udt || "_text").replace(/^_/, "");
      return { placeholder: `$${idx}::${elem}[]`, value: arr };
    }
    case "timestamptz":
    case "timestamp":
    case "date":
      return { placeholder: `$${idx}::${cast}`, value: String(rawValue) };
    case "uuid":
      return { placeholder: `$${idx}::uuid`, value: String(rawValue) };
    case "numeric":
      return { placeholder: `$${idx}::numeric`, value: rawValue };
    default:
      return { placeholder: `$${idx}`, value: rawValue };
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
