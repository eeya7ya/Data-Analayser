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
  const textTokens = tokenize(query.text || "");
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
  limit = 10,
): Promise<Array<ScoredProduct & { system: SystemEntry }>> {
  const tokens = tokenize(text);
  // Pre-filter systems whose vendor/category matches any token, otherwise
  // fall back to scanning all systems.
  let candidates = SYSTEMS.filter((s) => {
    const hay = `${s.vendor} ${s.category} ${s.name}`.toLowerCase();
    return tokens.some((t) => hay.includes(t));
  });
  if (candidates.length === 0) candidates = SYSTEMS;

  const results: Array<ScoredProduct & { system: SystemEntry }> = [];
  for (const sys of candidates.slice(0, 8)) {
    try {
      const { db } = await loadSystem(sys);
      const hits = searchProducts(db, { text, limit: 5 });
      for (const h of hits) results.push({ ...h, system: sys });
    } catch {
      /* ignore */
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export { SYSTEMS, MANIFEST };
