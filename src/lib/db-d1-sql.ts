/**
 * D1 (SQLite) execution engine that emulates the slice of the `postgres`
 * tagged-template API the app actually uses, so existing query call-sites can
 * run against Cloudflare D1 without rewriting each one. The Postgres→SQLite
 * dialect translation happens centrally here.
 *
 * Enabled only when USE_D1=1 (see src/lib/db.ts). OFF by default, so this file
 * is dormant until the switch is flipped — merging it changes nothing on the
 * live (Postgres) app.
 *
 * ── STATUS: STAGE 1 ──────────────────────────────────────────────────────────
 * Handles the common shapes: parameterised CRUD, `now()`, `::casts`, `ILIKE`,
 * `= any(${array})`, `RETURNING`, and boolean/Date/json params. The hard parts
 * are tracked for later stages and will break until done — verify on a PREVIEW
 * deployment, never straight to production:
 *   - Full-text search (tsvector / @@): needs SQLite FTS5 — src/lib/search.ts.
 *   - JSON filters (->>, @>, jsonb_*): need json_extract() / json_each().
 *   - Interactive transactions (q.begin): D1 REST runs statements inline (no
 *     real transaction); the four call-sites need review.
 *   - generate_series: needs a recursive CTE.
 */
import { d1Query } from "./db-d1";

const JSON_WRAP = Symbol("d1json");
type JsonWrap = { [JSON_WRAP]: true; value: unknown };

/** Translate the Postgres dialect to SQLite for the query shapes we use. */
export function translatePgToSqlite(text: string): string {
  let s = text;
  // `= any(${arr})` → `IN (...)`  (the array is expanded to ?,?,… at bind time)
  s = s.replace(/=\s*any\s*\(/gi, "IN (");
  // now() → CURRENT_TIMESTAMP (timestamps are stored as ISO text)
  s = s.replace(/\bnow\s*\(\s*\)/gi, "CURRENT_TIMESTAMP");
  // gen_random_uuid() → random 16-byte hex
  s = s.replace(/\bgen_random_uuid\s*\(\s*\)/gi, "(lower(hex(randomblob(16))))");
  // `::type` / `::type[]` casts → removed (SQLite is dynamically typed)
  s = s.replace(/::\s*"?[a-zA-Z_][a-zA-Z0-9_]*"?(\s*\[\s*\])?/g, "");
  // ILIKE → LIKE (SQLite LIKE is case-insensitive for ASCII)
  s = s.replace(/\bilike\b/gi, "LIKE");
  return s;
}

function normParam(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const w = v as Partial<JsonWrap>;
    if (w[JSON_WRAP]) return JSON.stringify(w.value);
    return JSON.stringify(v);
  }
  return String(v);
}

async function exec(text: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const sqlite = translatePgToSqlite(text);
  const bound = params.map(normParam);
  const res = await d1Query(sqlite, bound);
  return res.results as Record<string, unknown>[];
}

/** Build SQL text + flat params from a tagged template, expanding arrays. */
function build(
  strings: TemplateStringsArray,
  values: unknown[],
): { text: string; params: unknown[] } {
  let text = "";
  const params: unknown[] = [];
  strings.forEach((str, i) => {
    text += str;
    if (i < values.length) {
      const v = values[i];
      if (Array.isArray(v)) {
        text += v.length ? v.map(() => "?").join(", ") : "NULL";
        params.push(...v);
      } else {
        text += "?";
        params.push(v);
      }
    }
  });
  return { text, params };
}

export interface D1SqlClient {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  unsafe(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  json(value: unknown): JsonWrap;
  begin<T>(fn: (tx: D1SqlClient) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

let cached: D1SqlClient | null = null;

/** Process-wide D1-backed client that mimics the `postgres` call surface. */
export function getD1Sql(): D1SqlClient {
  if (cached) return cached;
  const client = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const { text, params } = build(strings, values);
    return exec(text, params);
  }) as D1SqlClient;
  client.unsafe = (text: string, params: unknown[] = []) => exec(text, params);
  client.json = (value: unknown): JsonWrap => ({ [JSON_WRAP]: true, value });
  // D1's REST API has no interactive transaction; statements run inline. The
  // handful of q.begin call-sites are reviewed in a later stage.
  client.begin = async <T,>(fn: (tx: D1SqlClient) => Promise<T>) => fn(client);
  client.end = async () => {};
  cached = client;
  return client;
}
