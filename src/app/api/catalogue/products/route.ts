import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { sql, ensureSchema, usingD1, rawBinder } from "@/lib/db";
import { tokenize, expandWithAliases } from "@/lib/search";
import { isFtsReady, buildMatch, ftsPredicate } from "@/lib/fts";

export const runtime = "nodejs";

/**
 * GET /api/catalogue/products?vendor=X&system=Y&q=search&limit=N&offset=M
 *
 * Query products with optional vendor/system filters and deep text search.
 *
 * Deep search semantics
 * ─────────────────────
 * `q` is tokenised and each token is expanded via `expandWithAliases` (stems +
 * domain aliases like camera↔cctv↔ipc↔bullet). A row must match EVERY user
 * token (AND), where a token matches if ANY of its variants appears in ANY
 * searchable field (OR) — so "4mp bullet" requires both words (or aliases)
 * somewhere in the row, while "camera" also surfaces rows that only mention
 * "IPC" or "Dome".
 *
 * On D1 this runs through the FTS5 index (one inverted-index lookup) when it's
 * ready; otherwise (Postgres, or before the index is built) it falls back to an
 * ILIKE scan with identical semantics. The SQL is assembled as raw
 * parameterised text because the D1 client's tagged template returns a Promise,
 * not a composable fragment, so the old `.reduce((a,b) => db`${a} or ${b}`)`
 * fragment composition bound Promises as parameters instead of building SQL.
 */

const DEEP_FIELDS = [
  "model",
  "category",
  "sub_category",
  "description",
  "fast_view",
  "specifications",
] as const;

/**
 * Build the deep-search WHERE predicate (a SQL string), binding its values via
 * the shared `P`. Returns null when the query has no usable tokens (pure
 * punctuation / empty) so the caller skips it.
 */
function buildDeepSearch(
  q: string,
  includeVendor: boolean,
  ftsOn: boolean,
  P: (value: string | number) => string,
): string | null {
  const tokens = tokenize(q);
  if (tokens.length === 0) return null;

  if (ftsOn) {
    // One AND-of-OR group per user token, OR-ing that token's alias variants.
    const groups = tokens.map((t) => expandWithAliases([t]));
    const match = buildMatch(groups);
    if (match) return ftsPredicate("products", "id", P(match));
    // No usable FTS token — fall through to ILIKE.
  }

  const fields = includeVendor ? [...DEEP_FIELDS, "vendor"] : [...DEEP_FIELDS];
  const groupSqls: string[] = [];
  for (const t of tokens) {
    const variants = expandWithAliases([t]).map((v) => `%${v}%`);
    const ors: string[] = [];
    for (const p of variants) {
      for (const f of fields) ors.push(`${f} ilike ${P(p)}`);
    }
    groupSqls.push("(" + ors.join(" or ") + ")");
  }
  return groupSqls.join(" and ");
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    await ensureSchema();

    const sp = req.nextUrl.searchParams;
    const vendor = sp.get("vendor") || "";
    const system = sp.get("system") || "";
    const q = sp.get("q") || "";
    const limit = Math.min(Number(sp.get("limit")) || 200, 2000);
    const offset = Number(sp.get("offset")) || 0;

    const db = sql();
    const ftsOn = usingD1() && isFtsReady();
    const { P, params } = rawBinder();

    const where: string[] = [];
    if (vendor) where.push(`vendor = ${P(vendor)}`);
    if (system) where.push(`system = ${P(system)}`);
    // When there's no vendor filter, include the `vendor` column in the
    // haystack so global search can find rows by vendor name.
    const deepSql = q ? buildDeepSearch(q, /* includeVendor */ !vendor, ftsOn, P) : null;
    if (deepSql) where.push("(" + deepSql + ")");
    const whereSql = where.length ? "where " + where.join(" and ") : "";

    // Snapshot the WHERE params before adding limit/offset, so the COUNT query
    // (same WHERE, no limit/offset) binds exactly the placeholders it contains.
    const whereParams = [...params];
    const products = await db.unsafe(
      `select * from products ${whereSql} order by vendor, system, category, model limit ${P(limit)} offset ${P(offset)}`,
      params,
    );
    const countResult = await db.unsafe(
      `select count(*)::int as total from products ${whereSql}`,
      whereParams,
    );

    return NextResponse.json({
      products,
      total: countResult[0]?.total || 0,
      limit,
      offset,
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    return NextResponse.json({ error: msg || "query failed" }, { status: 500 });
  }
}
