/**
 * Product search against the Supabase `products` table.
 *
 * Replaces the old GitHub-JSON-based search. All queries now go directly
 * to Postgres via the `sql()` helper.
 */

import { sql, ensureSchema, usingD1, rawBinder } from "./db";
import { isFtsReady, matchAny, ftsPredicate } from "./fts";
import { getOrSet, cacheDelete } from "./cache";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Product {
  id: number;
  vendor: string;
  system: string;
  category: string;
  sub_category: string;
  fast_view: string;
  model: string;
  description: string;
  currency: string;
  price_si: number;
  specifications: string;
  created_at: string;
  updated_at: string;
}

export interface SystemEntry {
  vendor: string;
  system: string;
  currency: string;
  product_count: number;
}

export interface ScoredProduct {
  product: Product;
  score: number;
  reasons: string[];
  unitPrice: number;
  currency: string;
}

// ─── Aliases ────────────────────────────────────────────────────────────────

const SEARCH_ALIASES: Record<string, string[]> = {
  cctv: ["camera", "ipc", "dvr", "nvr", "ptz", "hikvision", "esviz"],
  camera: ["cctv", "ipc", "ptz", "bullet", "dome", "turret"],
  ip: ["ipc", "poe"],
  sound: ["speaker", "amplifier", "dsppa", "audio", "pa"],
  pa: ["speaker", "amplifier", "dsppa", "audio", "sound"],
  audio: ["speaker", "amplifier", "dsppa", "sound", "pa"],
  speaker: ["sound", "audio", "dsppa", "amplifier"],
  amplifier: ["sound", "audio", "dsppa", "speaker"],
  network: ["switch", "router", "aruba", "tenda", "planet", "poe"],
  networking: ["switch", "router", "aruba", "tenda", "planet", "poe"],
  switch: ["network", "poe", "aruba", "tenda", "planet"],
  router: ["network", "aruba", "tenda", "planet"],
  access: ["sib", "turnstile", "barrier", "door", "reader"],
  door: ["access", "sib", "reader", "lock"],
  cable: ["cables", "utp", "cat6", "hdmi", "coax", "fiber"],
  cables: ["cable", "utp", "cat6", "hdmi", "coax", "fiber"],
  intercom: ["fanvil", "hikvision", "video"],
  phone: ["pbx", "fanvil", "yeastar", "ip phone"],
  pbx: ["yeastar", "phone", "fanvil"],
  video: ["wall", "display", "monitor", "screen"],
  display: ["monitor", "screen", "video wall", "interactive"],
  monitor: ["display", "screen"],
  nvr: ["dvr", "cctv", "recorder"],
  dvr: ["nvr", "cctv", "recorder"],
  rack: ["cabinet", "extreme"],
  cabinet: ["rack", "extreme"],
  ups: ["legrand", "battery", "power"],
  power: ["ups", "schneider", "legrand"],
};

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 .+/-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function expandWithAliases(tokens: string[]): string[] {
  const out = new Set<string>(tokens);
  for (const t of tokens) {
    if (t.length > 3 && t.endsWith("s")) out.add(t.slice(0, -1));
    if (t.length > 4 && t.endsWith("es")) out.add(t.slice(0, -2));
    const aliases = SEARCH_ALIASES[t];
    if (aliases) for (const a of aliases) out.add(a);
  }
  return [...out];
}

// ─── Core search ────────────────────────────────────────────────────────────

export interface SearchQuery {
  text?: string;
  vendor?: string;
  system?: string;
  limit?: number;
}

/**
 * Search products in the Supabase `products` table.
 * If vendor+system are given, scopes to that system.
 * If only text is given, does a global cross-vendor search.
 */
export async function searchProducts(query: SearchQuery): Promise<ScoredProduct[]> {
  await ensureSchema();
  const q = sql();
  const limit = query.limit || 200;

  // If no text provided, just return products in the system
  if (!query.text?.trim()) {
    if (!query.vendor) return [];
    const rows = query.system
      ? await q`
          select * from products
          where vendor = ${query.vendor} and system = ${query.system}
          order by category, model
          limit ${limit}
        `
      : await q`
          select * from products
          where vendor = ${query.vendor}
          order by category, model
          limit ${limit}
        `;
    return rows.map((r) => ({
      product: r as unknown as Product,
      score: 1,
      reasons: [],
      unitPrice: Number(r.price_si) || 0,
      currency: String(r.currency || "USD"),
    }));
  }

  // Text search. Expand each token with stems + domain aliases, then match
  // either via FTS5 (on D1, when the index is ready) or via an ILIKE scan
  // (Postgres, or before the FTS index exists). The query is assembled as raw
  // parameterised SQL — the previous tagged-template fragment composition
  // (`patterns.map(...).reduce((a,b) => q`${a} or ${b}`)`) does not work through
  // the D1 client, whose tagged template returns a Promise rather than a
  // composable fragment, so the OR-chain bound a Promise as a parameter.
  const tokens = expandWithAliases(tokenize(query.text));
  if (tokens.length === 0) return [];

  const searchPattern = `%${query.text.trim()}%`;
  const { P, params } = rawBinder();

  // Relevance score: where the whole phrase appears. Unchanged ranking; only
  // the global (no-vendor) variant scores the vendor column. Bound first so the
  // placeholder order matches the SELECT-then-WHERE position of each `?`/`$n`.
  const scoreTerms: Array<[string, number]> = query.vendor
    ? [
        ["model", 8],
        ["category", 5],
        ["sub_category", 5],
        ["description", 2],
        ["fast_view", 3],
      ]
    : [
        ["model", 8],
        ["category", 5],
        ["sub_category", 5],
        ["description", 2],
        ["vendor", 4],
        ["fast_view", 3],
      ];
  const fields = query.vendor
    ? ["model", "category", "sub_category", "description", "fast_view"]
    : ["model", "category", "sub_category", "description", "vendor", "fast_view"];

  const scoreSql =
    "(" +
    scoreTerms
      .map(([c, w]) => `case when ${c} ilike ${P(searchPattern)} then ${w} else 0 end`)
      .join(" + ") +
    ") as _score";

  // Scope filters (system only narrows within a vendor, as before).
  const scope: string[] = [];
  if (query.vendor) {
    scope.push(`vendor = ${P(query.vendor)}`);
    if (query.system) scope.push(`system = ${P(query.system)}`);
  }

  // Haystack: FTS5 MATCH on D1 (one inverted-index lookup), else an ILIKE
  // OR-chain across the text columns (Postgres, or before the index is built).
  const matchStr = usingD1() && isFtsReady() ? matchAny(tokens) : null;
  let haystackSql: string;
  if (matchStr) {
    haystackSql = ftsPredicate("products", "id", P(matchStr));
  } else {
    const ors: string[] = [];
    for (const t of tokens) {
      const pattern = `%${t}%`;
      for (const f of fields) ors.push(`${f} ilike ${P(pattern)}`);
    }
    haystackSql = "(" + ors.join(" or ") + ")";
  }

  const where = [...scope, haystackSql].join(" and ");
  const text = `select *, ${scoreSql} from products where ${where} order by _score desc, model limit ${P(limit)}`;
  const rows = await q.unsafe(text, params);

  return rows.map((r) => ({
    product: r as unknown as Product,
    score: Number(r._score) || 1,
    reasons: [],
    unitPrice: Number(r.price_si) || 0,
    currency: String(r.currency || "USD"),
  }));
}

/** Global cross-vendor search. */
export async function globalSearch(
  text: string,
  limit = 80,
): Promise<ScoredProduct[]> {
  return searchProducts({ text, limit });
}

/** Find a system by vendor+system name. */
export async function findSystemEntry(
  vendor: string,
  system?: string,
): Promise<SystemEntry | null> {
  await ensureSchema();
  const q = sql();
  const rows = system
    ? await q`
        select vendor, system, currency, count(*)::int as product_count
        from products
        where vendor = ${vendor} and system = ${system}
        group by vendor, system, currency
        limit 1
      `
    : await q`
        select vendor, system, currency, count(*)::int as product_count
        from products
        where vendor = ${vendor}
        group by vendor, system, currency
        limit 1
      `;
  if (rows.length === 0) return null;
  return rows[0] as unknown as SystemEntry;
}

/**
 * Cache key for the systems list. The list is identical for every user and
 * only changes when the catalogue is edited, but it `GROUP BY`s the WHOLE
 * products table — i.e. it reads every product row on each call. D1 bills on
 * rows read, so caching it removes that scan from every catalogue page load.
 */
const SYSTEMS_CACHE_KEY = "catalogue:systems";
const SYSTEMS_CACHE_TTL_MS = 60_000;

/**
 * Drop the cached systems list. Call after any write that can change the set
 * of vendors/systems/currencies or the per-system count (catalogue upload,
 * per-row edit, delete). The 60s TTL is a backstop, so a missed call only
 * leaves the list stale for up to a minute.
 */
export function invalidateSystemsCache(): void {
  cacheDelete(SYSTEMS_CACHE_KEY);
}

/** List all systems (cached; see SYSTEMS_CACHE_KEY). */
export async function listSystems(): Promise<SystemEntry[]> {
  await ensureSchema();
  return getOrSet(SYSTEMS_CACHE_KEY, SYSTEMS_CACHE_TTL_MS, async () => {
    const q = sql();
    const rows = await q`
      select vendor, system, currency, count(*)::int as product_count
      from products
      group by vendor, system, currency
      order by vendor, system
    `;
    return rows as unknown as SystemEntry[];
  });
}
