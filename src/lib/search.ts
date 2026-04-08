/**
 * Smart search over the GitHub-hosted JSON product DBs.
 *
 * Lightweight, dependency-free scoring:
 *   - Exact token match in model/category/sub_category → strong weight
 *   - Partial (substring) match → medium weight
 *   - Numeric constraint satisfaction (ports, resolution, ir_range_m, etc.)
 *   - Feature boolean match (poe, colorvu, acusense...)
 *
 * The result is ranked and truncated. The Groq design endpoint consumes this
 * as grounded context, so we keep it small and relevant.
 */

import { fetchJson } from "./github";
import { SYSTEMS, MANIFEST, SystemEntry } from "./manifest.generated";

export type Product = Record<string, unknown> & {
  id?: number | string;
  model?: string;
  category?: string;
  sub_category?: string;
  pricing?: { dpp?: number; si?: number } | Record<string, number>;
  specs?: Record<string, unknown>;
};

export interface ProductDb {
  database_info?: Record<string, unknown>;
  products?: Product[];
}

export interface ScoredProduct {
  product: Product;
  score: number;
  reasons: string[];
  unitPrice: number;
  currency: string;
}

const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 .+/-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Very light stemming so "cameras" still matches "camera" etc. */
function expandTokens(tokens: string[]): string[] {
  const out = new Set<string>();
  for (const t of tokens) {
    if (!t) continue;
    out.add(t);
    if (t.length > 3 && t.endsWith("s")) out.add(t.slice(0, -1));
    if (t.length > 4 && t.endsWith("es")) out.add(t.slice(0, -2));
    if (t.length > 3 && t.endsWith("ing")) out.add(t.slice(0, -3));
  }
  return [...out];
}

/** Common vendor / category aliases so the user can type human words. */
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

function expandWithAliases(tokens: string[]): string[] {
  const out = new Set<string>(tokens);
  for (const t of tokens) {
    const aliases = SEARCH_ALIASES[t];
    if (aliases) for (const a of aliases) out.add(a);
  }
  return [...out];
}

function flatten(obj: unknown, depth = 0, acc: string[] = []): string[] {
  if (depth > 4 || obj == null) return acc;
  if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") {
    acc.push(String(obj));
    return acc;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) flatten(v, depth + 1, acc);
    return acc;
  }
  if (typeof obj === "object") {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      flatten(v, depth + 1, acc);
    }
  }
  return acc;
}

function getPrice(p: Product): number {
  const pr = (p.pricing || {}) as Record<string, unknown>;
  const candidates = ["si", "dpp", "price", "retail", "list"];
  for (const k of candidates) {
    const v = pr[k];
    if (typeof v === "number") return v;
  }
  // look one level deeper
  for (const v of Object.values(pr)) {
    if (typeof v === "number") return v;
  }
  return 0;
}

export function findSystem(idOrKey: string | number): SystemEntry | null {
  if (typeof idOrKey === "number" || /^\d+$/.test(String(idOrKey))) {
    const id = Number(idOrKey);
    return SYSTEMS.find((s) => s.id === id) || null;
  }
  const key = String(idOrKey).toLowerCase();
  return (
    SYSTEMS.find(
      (s) =>
        `${s.vendor} ${s.category}`.toLowerCase().includes(key) ||
        s.dbPath.toLowerCase().includes(key),
    ) || null
  );
}

export async function loadSystem(system: SystemEntry): Promise<{
  db: ProductDb;
  theory: unknown | null;
}> {
  const [db, theory] = await Promise.all([
    fetchJson<ProductDb>(system.dbPath),
    system.theoryPath
      ? fetchJson<unknown>(system.theoryPath).catch(() => null)
      : Promise.resolve(null),
  ]);
  return { db, theory };
}

export interface SearchQuery {
  text?: string;
  filters?: Record<string, string | number | boolean>;
  limit?: number;
}

export function searchProducts(
  db: ProductDb,
  query: SearchQuery,
): ScoredProduct[] {
  const products = db.products || [];
  const currency =
    (db.database_info?.currency as string | undefined) || "USD";
  const rawTokens = tokenize(query.text || "");
  // Include singular/plural stems so "cameras" finds "camera" products too.
  const textTokens = expandTokens(rawTokens);
  const filters = query.filters || {};
  const scored: ScoredProduct[] = [];

  for (const p of products) {
    const reasons: string[] = [];
    let score = 0;
    const flat = flatten(p).join(" ").toLowerCase();

    // Text scoring
    for (const t of textTokens) {
      if (!t) continue;
      const modelMatch =
        typeof p.model === "string" && p.model.toLowerCase().includes(t);
      const catMatch =
        (typeof p.category === "string" && p.category.toLowerCase().includes(t)) ||
        (typeof p.sub_category === "string" &&
          p.sub_category.toLowerCase().includes(t));
      if (modelMatch) {
        score += 8;
        reasons.push(`model matches "${t}"`);
      } else if (catMatch) {
        score += 5;
        reasons.push(`category matches "${t}"`);
      } else if (flat.includes(t)) {
        score += 2;
      }
    }

    // Filter scoring
    for (const [k, v] of Object.entries(filters)) {
      const value = (p as Record<string, unknown>)[k] ??
        (p.specs as Record<string, unknown> | undefined)?.[k];
      if (value === undefined) continue;
      if (typeof v === "boolean") {
        if (Boolean(value) === v) {
          score += 4;
          reasons.push(`${k}=${v}`);
        }
      } else if (typeof v === "number") {
        if (typeof value === "number") {
          if (value >= v) {
            score += 4;
            reasons.push(`${k}>=${v}`);
          } else {
            score -= 2;
          }
        }
      } else {
        if (String(value).toLowerCase().includes(String(v).toLowerCase())) {
          score += 4;
          reasons.push(`${k} contains "${v}"`);
        }
      }
    }

    if (score > 0 || textTokens.length === 0) {
      scored.push({
        product: p,
        score: score || 1,
        reasons,
        unitPrice: getPrice(p),
        currency,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, query.limit || 15);
}

/** Global cross-vendor search (used when the AI needs broader candidates). */
export async function globalSearch(
  text: string,
  limit = 80,
): Promise<Array<ScoredProduct & { system: SystemEntry }>> {
  const rawTokens = tokenize(text);
  const tokens = expandWithAliases(expandTokens(rawTokens));

  // Rank systems by how many query tokens (or aliases of them) they match
  // in vendor/category/name — but still scan every system afterwards so
  // niche products with the query term deep in their specs are never
  // silently excluded.
  const ranked = SYSTEMS.map((s) => {
    const hay = `${s.vendor} ${s.category} ${s.name} ${s.manufacturer || ""}`
      .toLowerCase();
    const sysScore = tokens.reduce(
      (acc, t) => (hay.includes(t) ? acc + 1 : acc),
      0,
    );
    return { s, sysScore };
  }).sort((a, b) => b.sysScore - a.sysScore);
  const candidates = ranked.map((r) => r.s);

  // Per-system cap is high enough that broad vendors (Hikvision, DSPPA)
  // can still surface a meaningful spread of matching products.
  const perSystemLimit = Math.max(20, Math.ceil(limit / 2));

  const chunks = await Promise.all(
    candidates.map(async (sys) => {
      try {
        const { db } = await loadSystem(sys);
        const hits = searchProducts(db, { text, limit: perSystemLimit });
        return hits.map((h) => ({ ...h, system: sys }));
      } catch {
        return [] as Array<ScoredProduct & { system: SystemEntry }>;
      }
    }),
  );

  const results = chunks.flat();
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export { SYSTEMS, MANIFEST };
