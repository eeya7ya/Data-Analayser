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
 * ── STATUS: STAGE 2 ──────────────────────────────────────────────────────────
 * Handles: parameterised CRUD, `now()`, `::casts`, `ILIKE` (search.ts uses
 * ILIKE, not tsvector — so search just works), `= any(${array})`, `RETURNING`,
 * boolean/Date/json params, and the json builder/aggregate functions
 * (`jsonb_build_object`→`json_object`, `jsonb_agg`→`json_group_array`,
 * `string_agg`→`group_concat`, …). No `->>`/`@>` operators are used anywhere.
 *
 * Remaining gaps (small, countable) — verify on a PREVIEW, never straight to
 * production; each is fixed per-site as preview testing surfaces it:
 *   - `jsonb_set(target,'{a,b}',v)`: SQLite path is `$.a.b`, not `{a,b}`.
 *   - `array_agg`: returns a comma string via group_concat — consumers that
 *     expect a real array need a JSON.parse (use json_group_array there).
 *   - Date funcs `to_char` / `date_trunc` / `extract(... from)`: format/semantic
 *     differences — a few call-sites, rewritten individually.
 *   - `generate_series`: needs a recursive CTE (≈5 call-sites).
 *   - Interactive transactions (`q.begin`, 4 sites): D1 REST runs inline.
 */
import { d1Query } from "./db-d1";
import { D1_SCHEMA_SQL } from "./d1Schema.generated";

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
  // `is [not] distinct from` → SQLite's null-safe `IS` / `IS NOT`.
  s = s.replace(/\bis\s+not\s+distinct\s+from\b/gi, "IS");
  s = s.replace(/\bis\s+distinct\s+from\b/gi, "IS NOT");
  // JSON builders / aggregates / helpers → SQLite equivalents (clean 1:1 maps).
  s = s.replace(/\bjsonb?_build_object\b/gi, "json_object");
  s = s.replace(/\bjsonb?_build_array\b/gi, "json_array");
  s = s.replace(/\bjsonb?_agg\b/gi, "json_group_array");
  s = s.replace(/\bjsonb?_object_agg\b/gi, "json_group_object");
  s = s.replace(/\bjsonb?_array_length\b/gi, "json_array_length");
  s = s.replace(/\bstring_agg\b/gi, "group_concat");
  return s;
}

// ── Auto-fill NOT NULL columns with defaults on INSERT ───────────────────────
// The Postgres schema gives columns like created_at/updated_at, custom_fields,
// items_json, status, tax_percent, … a DEFAULT (now(), '{}', '[]', 'active', …).
// The D1 schema port dropped those column DEFAULTs, so any INSERT that omits
// such a column — most of the app's inserts were written against the Postgres
// defaults — fails on D1 with "NOT NULL constraint failed: <table>.<col>"
// (created_at, then custom_fields, …). Rather than edit dozens of call-sites,
// inject the omitted NOT NULL columns + their schema default value here, for any
// single-row `insert into T (cols) values (...)`. The value is a literal, so the
// bound-param count is unchanged and placeholders still line up. Only NOT NULL
// columns that CAN be defaulted are filled: created_at/updated_at get
// CURRENT_TIMESTAMP; others use the schema DEFAULT. NOT NULL columns without a
// default (genuine required business fields) are left for the caller to supply,
// so a real omission still surfaces instead of being masked. Nullable columns,
// INSERT..SELECT and multi-row VALUES are untouched.

type InjectCol = { name: string; value: string };
let injectColsCache: Map<string, InjectCol[]> | null = null;
function injectableColumns(): Map<string, InjectCol[]> {
  if (injectColsCache) return injectColsCache;
  const out = new Map<string, InjectCol[]>();
  const tableRe =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?\s*\(([\s\S]*?)\)\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(D1_SCHEMA_SQL))) {
    const table = m[1].toLowerCase();
    const cols: InjectCol[] = [];
    for (const rawLine of m[2].split("\n")) {
      const line = rawLine.trim().replace(/,\s*$/, "");
      const cm = /^"(\w+)"\s+(.+)$/.exec(line); // column lines start with "name"
      if (!cm) continue; // PRIMARY KEY / FOREIGN KEY / … constraint line
      const name = cm[1];
      const rest = cm[2];
      if (!/\bnot\s+null\b/i.test(rest)) continue; // nullable → omitting is fine
      const lname = name.toLowerCase();
      if (lname === "created_at" || lname === "updated_at") {
        cols.push({ name, value: "CURRENT_TIMESTAMP" });
        continue;
      }
      // `DEFAULT '…'` (string, '' escapes handled) or `DEFAULT <token>` (number
      // / keyword). Skip complex parenthesised defaults — none exist today.
      const dm = /\bdefault\s+('(?:[^']|'')*'|[^\s,)]+)/i.exec(rest);
      if (dm && !dm[1].startsWith("(")) cols.push({ name, value: dm[1] });
      // NOT NULL without a usable default → the caller must supply it.
    }
    if (cols.length) out.set(table, cols);
  }
  injectColsCache = out;
  return out;
}

/** Index of the ')' matching the '(' at openIdx, skipping single-quoted text. */
function matchingParen(s: string, openIdx: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "'") {
        if (s[i + 1] === "'") {
          i++;
          continue;
        }
        inStr = false;
      }
      continue;
    }
    if (ch === "'") inStr = true;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function fillInsertDefaults(text: string): string {
  const head = /^\s*insert\s+into\s+"?(\w+)"?\s*\(([^)]*)\)\s*values\s*\(/i.exec(
    text,
  );
  if (!head) return text; // INSERT..SELECT / INSERT OR REPLACE / not an insert
  const table = head[1].toLowerCase();
  const cols = head[2];
  const injectable = injectableColumns().get(table);
  if (!injectable || injectable.length === 0) return text;
  const need = injectable.filter(
    (c) => !new RegExp(`\\b${c.name}\\b`, "i").test(cols),
  );
  if (need.length === 0) return text;

  const openIdx = head.index + head[0].length - 1; // the '(' after VALUES
  const closeIdx = matchingParen(text, openIdx);
  if (closeIdx < 0) return text;
  // Multi-row VALUES (...),(...): a trailing comma means more tuples we can't
  // safely reach, so leave the statement untouched.
  if (/^\s*,/.test(text.slice(closeIdx + 1))) return text;

  const colInject = need.map((c) => `, "${c.name}"`).join("");
  const valInject = need.map((c) => `, ${c.value}`).join("");
  const newHead = head[0].replace(
    /\)\s*values\s*\(\s*$/i,
    `${colInject}) values (`,
  );
  return (
    text.slice(0, head.index) +
    newHead +
    text.slice(head.index + head[0].length, closeIdx) +
    valInject +
    text.slice(closeIdx)
  );
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
  const sqlite = translatePgToSqlite(fillInsertDefaults(text));
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
