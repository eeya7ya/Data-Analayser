/**
 * Product search against the Supabase `products` table.
 *
 * Replaces the old GitHub-JSON-based search. All queries now go directly
 * to Postgres via the `sql()` helper.
 */

import { sql, ensureSchema } from "./db";

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

  // Text search — build ILIKE conditions for each expanded token
  const tokens = expandWithAliases(tokenize(query.text));
  if (tokens.length === 0) return [];

  const patterns = tokens.map((t) => `%${t}%`);

  // Build a single search across the haystack columns
  const searchPattern = `%${query.text.trim()}%`;
  let rows;

  if (query.vendor && query.system) {
    rows = await q`
      select *,
        (case when model ilike ${searchPattern} then 8 else 0 end +
         case when category ilike ${searchPattern} then 5 else 0 end +
         case when sub_category ilike ${searchPattern} then 5 else 0 end +
         case when description ilike ${searchPattern} then 2 else 0 end +
         case when fast_view ilike ${searchPattern} then 3 else 0 end) as _score
      from products
      where vendor = ${query.vendor}
        and system = ${query.system}
        and (${patterns.map((p) => q`
          model ilike ${p} or category ilike ${p} or sub_category ilike ${p}
          or description ilike ${p} or vendor ilike ${p} or fast_view ilike ${p}
        `).reduce((a, b) => q`${a} or ${b}`)})
      order by _score desc, model
      limit ${limit}
    `;
  } else if (query.vendor) {
    rows = await q`
      select *,
        (case when model ilike ${searchPattern} then 8 else 0 end +
         case when category ilike ${searchPattern} then 5 else 0 end +
         case when sub_category ilike ${searchPattern} then 5 else 0 end +
         case when description ilike ${searchPattern} then 2 else 0 end +
         case when fast_view ilike ${searchPattern} then 3 else 0 end) as _score
      from products
      where vendor = ${query.vendor}
        and (${patterns.map((p) => q`
          model ilike ${p} or category ilike ${p} or sub_category ilike ${p}
          or description ilike ${p} or vendor ilike ${p} or fast_view ilike ${p}
        `).reduce((a, b) => q`${a} or ${b}`)})
      order by _score desc, model
      limit ${limit}
    `;
  } else {
    // Global search
    rows = await q`
      select *,
        (case when model ilike ${searchPattern} then 8 else 0 end +
         case when category ilike ${searchPattern} then 5 else 0 end +
         case when sub_category ilike ${searchPattern} then 5 else 0 end +
         case when description ilike ${searchPattern} then 2 else 0 end +
         case when vendor ilike ${searchPattern} then 4 else 0 end +
         case when fast_view ilike ${searchPattern} then 3 else 0 end) as _score
      from products
      where (${patterns.map((p) => q`
        model ilike ${p} or category ilike ${p} or sub_category ilike ${p}
        or description ilike ${p} or vendor ilike ${p} or fast_view ilike ${p}
      `).reduce((a, b) => q`${a} or ${b}`)})
      order by _score desc, model
      limit ${limit}
    `;
  }

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

/** List all systems. */
export async function listSystems(): Promise<SystemEntry[]> {
  await ensureSchema();
  const q = sql();
  const rows = await q`
    select vendor, system, currency, count(*)::int as product_count
    from products
    group by vendor, system, currency
    order by vendor, system
  `;
  return rows as unknown as SystemEntry[];
}
