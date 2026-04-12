import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import { tokenize, expandWithAliases } from "@/lib/search";

export const runtime = "nodejs";

/**
 * GET /api/catalogue/products?vendor=X&system=Y&q=search&limit=N&offset=M
 *
 * Query products from Supabase with optional filters and deep search.
 *
 * Deep search semantics
 * ─────────────────────
 * The `q` param is tokenised and each token is expanded via the shared
 * `expandWithAliases` helper in `@/lib/search` (stems + domain aliases like
 * camera↔cctv↔ipc↔bullet). Every token's variant set is OR'd across all
 * searchable text fields, and token groups are AND'd together — so typing
 * "4mp bullet" requires BOTH words (or their aliases) to appear somewhere
 * in the row, while typing "camera" surfaces rows that only mention "IPC"
 * or "Dome". The `specifications` column is included in the haystack so
 * values written only in specs (e.g. "Zigbee 3.0", "8MP 4K") also match.
 */

type DbClient = ReturnType<typeof sql>;

/**
 * Build an ILIKE predicate of the form
 *   (variants-of-token-1) AND (variants-of-token-2) AND …
 * where each token's variant group is a flat OR across all searchable fields.
 * Returns `null` when the query contains no usable tokens (pure punctuation,
 * empty string, …) so the caller can fall through to a non-`q` branch.
 *
 * Fragment composition follows the same pattern already used in
 * `src/lib/search.ts` (interpolating tagged-template fragments into another
 * tagged-template literal). We let TypeScript infer the fragment types from
 * the `postgres` library rather than naming them explicitly.
 */
function buildDeepSearchPredicate(
  db: DbClient,
  q: string,
  includeVendor: boolean,
) {
  const tokens = tokenize(q);
  if (tokens.length === 0) return null;

  const groups = tokens.map((t) => {
    // Expand per-token so each user word keeps its own alias group.
    const variants = expandWithAliases([t]).map((v) => `%${v}%`);
    const clauses = variants.flatMap((p) => {
      const perField = [
        db`model ilike ${p}`,
        db`category ilike ${p}`,
        db`sub_category ilike ${p}`,
        db`description ilike ${p}`,
        db`fast_view ilike ${p}`,
        db`specifications ilike ${p}`,
      ];
      if (includeVendor) perField.push(db`vendor ilike ${p}`);
      return perField;
    });
    return clauses.reduce((a, b) => db`${a} or ${b}`);
  });

  return groups.map((g) => db`(${g})`).reduce((a, b) => db`${a} and ${b}`);
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

    // When there's no vendor filter, include the `vendor` column in the
    // haystack so global search can find rows by vendor name.
    const deepPred = q
      ? buildDeepSearchPredicate(db, q, /* includeVendor */ !vendor)
      : null;
    const hasDeepQuery = deepPred !== null;

    let products;
    let countResult;

    if (vendor && system && hasDeepQuery) {
      products = await db`
        select * from products
        where vendor = ${vendor} and system = ${system} and (${deepPred})
        order by vendor, system, category, model
        limit ${limit} offset ${offset}
      `;
      countResult = await db`
        select count(*)::int as total from products
        where vendor = ${vendor} and system = ${system} and (${deepPred})
      `;
    } else if (vendor && system) {
      products = await db`
        select * from products
        where vendor = ${vendor} and system = ${system}
        order by vendor, system, category, model
        limit ${limit} offset ${offset}
      `;
      countResult = await db`
        select count(*)::int as total from products
        where vendor = ${vendor} and system = ${system}
      `;
    } else if (vendor && hasDeepQuery) {
      products = await db`
        select * from products
        where vendor = ${vendor} and (${deepPred})
        order by vendor, system, category, model
        limit ${limit} offset ${offset}
      `;
      countResult = await db`
        select count(*)::int as total from products
        where vendor = ${vendor} and (${deepPred})
      `;
    } else if (vendor) {
      products = await db`
        select * from products
        where vendor = ${vendor}
        order by vendor, system, category, model
        limit ${limit} offset ${offset}
      `;
      countResult = await db`
        select count(*)::int as total from products
        where vendor = ${vendor}
      `;
    } else if (hasDeepQuery) {
      products = await db`
        select * from products
        where ${deepPred}
        order by vendor, system, category, model
        limit ${limit} offset ${offset}
      `;
      countResult = await db`
        select count(*)::int as total from products
        where ${deepPred}
      `;
    } else {
      products = await db`
        select * from products
        order by vendor, system, category, model
        limit ${limit} offset ${offset}
      `;
      countResult = await db`
        select count(*)::int as total from products
      `;
    }

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
