#!/usr/bin/env node
/**
 * Reverse migration: copy every row from Cloudflare D1 (SQLite) BACK into a
 * Postgres database (e.g. Neon or a fresh Supabase project).
 *
 * Why this exists
 * ───────────────
 * The forward path (src/app/api/admin/d1-migrate-data/route.ts) copied
 * Supabase Postgres → D1 during the dual-run period. If the Postgres side is
 * later lost (e.g. the Supabase project was deleted) the *data* still lives in
 * D1 — this script puts it back into any Postgres so the app (which speaks
 * Postgres natively) can run again with ZERO code changes.
 *
 * It faithfully reverses the forward conversions:
 *   - booleans were stored as 0/1            → back to true/false
 *   - dates were stored as ISO strings        → passed through (Postgres parses)
 *   - bytea was stored as hex strings         → decode('…','hex')
 *   - json/jsonb/arrays were JSON.stringify'd → re-parsed and cast
 *   - rows over D1's ~1MB cap had their biggest column offloaded to R2 with a
 *     {"__r2_overflow__":true,…} marker        → fetched back from R2 and inlined
 *
 * Prerequisites
 * ─────────────
 *   1. The Postgres SCHEMA must already exist. The app builds it automatically:
 *      set DATABASE_URL to your new Postgres in Vercel and load any page once
 *      (ensureSchema() creates all tables), OR run `npm run db:init` first.
 *      This script REFUSES to run against an empty database so it can't
 *      silently load into the wrong/uninitialised target.
 *   2. Env vars:
 *        DATABASE_URL                    Postgres target (Neon/Supabase/…)
 *        CLOUDFLARE_ACCOUNT_ID           Cloudflare account
 *        CLOUDFLARE_D1_DATABASE_ID       D1 database id (wrangler.toml)
 *        CLOUDFLARE_API_TOKEN            token with D1 Read
 *      Optional (only needed if any row overflowed to R2 — the script tells
 *      you if they are missing and rows need them):
 *        CLOUDFLARE_R2_ACCESS_KEY_ID
 *        CLOUDFLARE_R2_SECRET_ACCESS_KEY
 *        CLOUDFLARE_R2_BUCKET            defaults to "magictech-files"
 *
 * Usage
 * ─────
 *   DATABASE_URL=postgres://… \
 *   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_D1_DATABASE_ID=… CLOUDFLARE_API_TOKEN=… \
 *   node scripts/migrate-d1-to-postgres.mjs
 *
 *   # preview without writing:
 *   DRY_RUN=1 … node scripts/migrate-d1-to-postgres.mjs
 *
 * Safe to re-run: every write is an UPSERT (INSERT … ON CONFLICT DO UPDATE),
 * so a second run overwrites rather than duplicating. No table is ever dropped.
 */
import postgres from "postgres";
import { createHash, createHmac } from "node:crypto";

// ─── config ──────────────────────────────────────────────────────────────────

const PG_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_D1_DB = process.env.CLOUDFLARE_D1_DATABASE_ID;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const R2_ACCESS = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET || "magictech-files";

const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const PAGE = Number(process.env.D1_PAGE_SIZE || 500);

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

if (!PG_URL) die("No Postgres target. Set DATABASE_URL to your Neon connection string.");
if (!CF_ACCOUNT || !CF_D1_DB || !CF_TOKEN) {
  die(
    "D1 source not configured. Set CLOUDFLARE_ACCOUNT_ID, " +
      "CLOUDFLARE_D1_DATABASE_ID and CLOUDFLARE_API_TOKEN (token needs D1 Read).",
  );
}

// ─── D1 REST client (port of src/lib/db-d1.ts) ───────────────────────────────

async function d1Query(sqlText, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${CF_D1_DB}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CF_TOKEN}`,
    },
    body: JSON.stringify({ sql: sqlText, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`D1 HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const env = await res.json();
  if (!env.success) {
    const m = env.errors?.map((e) => `${e.code}: ${e.message}`).join("; ");
    throw new Error(`D1 API error: ${m || "unknown"}`);
  }
  return env.result?.[0] ?? { results: [], success: true };
}

// ─── R2 GET via SigV4 (port of src/lib/r2.ts, read path only) ─────────────────

const R2_REGION = "auto";
const R2_SERVICE = "s3";

function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}
function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}
function awsUriEncode(input, encodeSlash = true) {
  const bytes = Buffer.from(input, "utf8");
  let out = "";
  for (const b of bytes) {
    if (
      (b >= 0x41 && b <= 0x5a) ||
      (b >= 0x61 && b <= 0x7a) ||
      (b >= 0x30 && b <= 0x39) ||
      b === 0x2d ||
      b === 0x5f ||
      b === 0x2e ||
      b === 0x7e
    ) {
      out += String.fromCharCode(b);
    } else if (b === 0x2f && !encodeSlash) {
      out += "/";
    } else {
      out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}
function r2Configured() {
  return Boolean(CF_ACCOUNT && R2_ACCESS && R2_SECRET);
}
async function r2GetObject(key) {
  if (!r2Configured()) {
    throw new Error(
      "R2 not configured but a row needs it. Set CLOUDFLARE_R2_ACCESS_KEY_ID " +
        "and CLOUDFLARE_R2_SECRET_ACCESS_KEY (and CLOUDFLARE_R2_BUCKET if not default).",
    );
  }
  const host = `${CF_ACCOUNT}.r2.cloudflarestorage.com`;
  const encodedKey = awsUriEncode(key, false);
  const url = `https://${host}/${R2_BUCKET}/${encodedKey}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex("");
  const canonicalHeaders =
    `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "GET",
    `/${R2_BUCKET}/${encodedKey}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmac(`AWS4${R2_SECRET}`, dateStamp);
  const kRegion = hmac(kDate, R2_REGION);
  const kService = hmac(kRegion, R2_SERVICE);
  const signingKey = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${R2_ACCESS}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Host: host,
      "X-Amz-Date": amzDate,
      "X-Amz-Content-Sha256": payloadHash,
      Authorization: authorization,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2 GET ${res.status} for ${key}: ${text.slice(0, 300)}`);
  }
  return res.text();
}

function isOverflowString(v) {
  return typeof v === "string" && v.includes('"__r2_overflow__"');
}

// ─── value conversion: D1 scalar → Postgres value for a given column type ─────

function pgCastFor(udt) {
  const u = (udt || "").toLowerCase();
  if (u === "bool") return "boolean";
  if (u === "json") return "json";
  if (u === "jsonb") return "jsonb";
  if (u === "bytea") return "bytea-hex"; // special-cased below
  if (u === "timestamptz") return "timestamptz";
  if (u === "timestamp") return "timestamp";
  if (u === "date") return "date";
  if (u === "uuid") return "uuid";
  if (u === "numeric") return "numeric";
  if (u.startsWith("_")) return "array"; // e.g. _text, _int4
  return null; // text/int/etc. — no explicit cast needed
}

/**
 * Returns { placeholder, value } for a single column. `idx` is the 1-based
 * positional parameter index. The placeholder embeds the cast so we never rely
 * on driver type-inference; the value is the JS param bound to it.
 */
function buildParam(rawValue, udt, idx) {
  const cast = pgCastFor(udt);

  if (rawValue === null || rawValue === undefined) {
    return { placeholder: `$${idx}`, value: null };
  }

  switch (cast) {
    case "boolean": {
      // D1 stored booleans as 0/1 (integers). Also tolerate '0'/'1'/true/false.
      const truthy =
        rawValue === 1 || rawValue === "1" || rawValue === true || rawValue === "true";
      return { placeholder: `$${idx}::boolean`, value: truthy };
    }
    case "json":
    case "jsonb": {
      // D1 stored JSON columns as JSON text. Pass the text straight through with
      // a ::jsonb cast. If it somehow arrived as an object, stringify it.
      const text = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
      return { placeholder: `$${idx}::${cast}`, value: text };
    }
    case "bytea-hex": {
      // D1 stored bytea as a hex string. decode() turns it back into bytes.
      return { placeholder: `decode($${idx}, 'hex')`, value: String(rawValue) };
    }
    case "array": {
      // Forward path JSON.stringify'd arrays. Parse back to a JS array and let
      // the driver encode it; element type derived from the udt (_text → text).
      let arr = rawValue;
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
      // text / varchar / int / float / serial — bind as-is.
      return { placeholder: `$${idx}`, value: rawValue };
  }
}

// ─── Postgres schema introspection ───────────────────────────────────────────

async function readPgSchema(q) {
  const cols = await q`
    select table_name, column_name, udt_name, ordinal_position
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position
  `;
  const pks = await q`
    select kcu.table_name, kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema = kcu.table_schema
    where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY'
    order by kcu.table_name, kcu.ordinal_position
  `;
  const tablesRaw = await q`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `;
  const fks = await q`
    select tc.table_name, ccu.table_name as referenced_table
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name
     and tc.table_schema = ccu.table_schema
    where tc.table_schema = 'public' and tc.constraint_type = 'FOREIGN KEY'
  `;

  const colsByTable = new Map();
  for (const c of cols) {
    const list = colsByTable.get(c.table_name) ?? [];
    list.push({ name: c.column_name, udt: c.udt_name });
    colsByTable.set(c.table_name, list);
  }
  const pkByTable = new Map();
  for (const p of pks) {
    const list = pkByTable.get(p.table_name) ?? [];
    list.push(p.column_name);
    pkByTable.set(p.table_name, list);
  }
  const tables = tablesRaw.map((t) => t.table_name);
  return { tables, colsByTable, pkByTable, fks };
}

function topoSort(tables, fks) {
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const fk of fks) {
    if (fk.table_name === fk.referenced_table) continue;
    if (!deps.has(fk.table_name) || !deps.has(fk.referenced_table)) continue;
    deps.get(fk.table_name).add(fk.referenced_table);
  }
  const out = [];
  const seen = new Set();
  const remaining = new Set(tables);
  while (remaining.size) {
    let progress = false;
    for (const t of Array.from(remaining)) {
      if (Array.from(deps.get(t)).every((d) => seen.has(d))) {
        out.push(t);
        seen.add(t);
        remaining.delete(t);
        progress = true;
      }
    }
    if (!progress) {
      // Cycle — emit the rest in any order (FK checks deferred per-row upsert).
      for (const t of Array.from(remaining)) out.push(t);
      break;
    }
  }
  return out;
}

// ─── D1 paged read ───────────────────────────────────────────────────────────

async function d1TableExists(table) {
  const r = await d1Query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    [table],
  );
  return r.results.length > 0;
}

async function* d1ReadRows(table) {
  let offset = 0;
  for (;;) {
    const r = await d1Query(
      `SELECT * FROM "${table}" LIMIT ${PAGE} OFFSET ${offset}`,
    );
    const rows = r.results ?? [];
    if (rows.length === 0) break;
    yield rows;
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nD1 → Postgres restore  ${DRY_RUN ? "(DRY RUN — no writes)" : ""}`);
  console.log("──────────────────────────────────────────────");

  const q = postgres(PG_URL, {
    ssl: "require",
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
  });

  let overflowFetched = 0;
  let overflowErrors = 0;
  const summary = [];

  try {
    const { tables, colsByTable, pkByTable, fks } = await readPgSchema(q);

    // Guard: refuse to run against an uninitialised database.
    if (!tables.includes("quotations") || !tables.includes("users")) {
      die(
        "Target Postgres has no app schema yet (no 'users'/'quotations' tables).\n" +
          "  Build the schema first: point the app's DATABASE_URL at this database\n" +
          "  and load any page once (ensureSchema creates all tables), then re-run.",
      );
    }

    const ordered = topoSort(tables, fks);
    console.log(`Postgres target ready — ${tables.length} tables. Loading in FK-safe order.\n`);

    for (const table of ordered) {
      const pgCols = colsByTable.get(table) ?? [];
      const pgColNames = new Set(pgCols.map((c) => c.name));
      const udtByCol = new Map(pgCols.map((c) => [c.name, c.udt]));
      const pk = pkByTable.get(table) ?? [];

      if (!(await d1TableExists(table))) {
        summary.push({ table, d1: "—", loaded: 0, note: "not in D1 (skipped)" });
        continue;
      }

      let d1Total = 0;
      let loaded = 0;
      const errors = [];

      for await (const page of d1ReadRows(table)) {
        for (const row of page) {
          d1Total++;
          // Only columns present in BOTH D1 and the PG schema.
          const cols = Object.keys(row).filter((c) => pgColNames.has(c));
          if (cols.length === 0) continue;

          // Rehydrate any R2-overflowed cells before type conversion.
          for (const c of cols) {
            if (isOverflowString(row[c])) {
              try {
                const ref = JSON.parse(row[c]);
                row[c] = await r2GetObject(ref.key);
                overflowFetched++;
              } catch (e) {
                overflowErrors++;
                errors.push(`row pk=${row[pk[0]] ?? "?"} col=${c}: overflow rehydrate failed: ${e.message}`);
              }
            }
          }

          // Build a single-row upsert with explicit casts.
          const placeholders = [];
          const values = [];
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
              ? `ON CONFLICT (${pk.map((c) => `"${c}"`).join(", ")}) ${updates ? `DO UPDATE SET ${updates}` : "DO NOTHING"}`
              : "";
          const stmt = `INSERT INTO "${table}" (${colIdents}) VALUES (${placeholders.join(", ")}) ${conflict}`;

          if (DRY_RUN) {
            loaded++;
            continue;
          }
          try {
            await q.unsafe(stmt, values);
            loaded++;
          } catch (e) {
            errors.push(`row pk=${row[pk[0]] ?? "?"}: ${e.message.slice(0, 180)}`);
          }
        }
      }

      // Reset the serial sequence so future inserts don't collide with loaded ids.
      if (!DRY_RUN && pk.length === 1 && pk[0] === "id" && loaded > 0) {
        try {
          await q.unsafe(
            `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'),
                    GREATEST((SELECT COALESCE(MAX(id), 1) FROM "${table}"), 1))`,
          );
        } catch {
          /* table may have no serial sequence — fine */
        }
      }

      const note = errors.length ? `${errors.length} row error(s)` : "ok";
      summary.push({ table, d1: d1Total, loaded, note });
      const status = errors.length ? "⚠ " : "✓ ";
      console.log(`${status}${table.padEnd(26)} D1:${String(d1Total).padStart(6)}  loaded:${String(loaded).padStart(6)}  ${note}`);
      for (const e of errors.slice(0, 5)) console.log(`     · ${e}`);
      if (errors.length > 5) console.log(`     · …and ${errors.length - 5} more`);
    }

    console.log("\n──────────────────────────────────────────────");
    const totalLoaded = summary.reduce((a, s) => a + (Number(s.loaded) || 0), 0);
    console.log(`Tables processed: ${summary.length}`);
    console.log(`Rows ${DRY_RUN ? "that WOULD be loaded" : "loaded"}: ${totalLoaded}`);
    if (overflowFetched) console.log(`R2-overflow cells rehydrated: ${overflowFetched}`);
    if (overflowErrors) console.log(`⚠ R2-overflow cells that FAILED: ${overflowErrors} (see per-row errors above)`);
    console.log(DRY_RUN ? "\nDRY RUN complete — re-run without DRY_RUN=1 to write." : "\n✓ Restore complete.");
  } finally {
    await q.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
