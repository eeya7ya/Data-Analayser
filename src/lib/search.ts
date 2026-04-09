/**
 * Smart search over the Postgres-backed product catalogue.
 *
 * Historically this module loaded JSON files from GitHub (via
 * `src/lib/github.ts`). That layer is gone — the catalogue now lives in the
 * `catalogue_items` Postgres table (see `scripts/migrate-catalogue.mjs`).
 * The scoring loop, alias expansion, stem expansion, and numeric / boolean
 * filter logic are UNCHANGED: they still run over the in-memory `Product`
 * shape so `CatalogBrowser` and `Designer` didn't need to change. The shim
 * `rowToProduct()` rebuilds that legacy shape from each DB row.
 *
 * If the catalogue_items table is empty (e.g. on a fresh deploy before the
 * seed has been run) we fall back to the legacy `manifest.generated.ts`
 * SYSTEMS and fetch JSON from GitHub. This keeps the app usable during
 * migration and is the only reason `manifest.generated.ts` is still in the
 * tree — delete both once the seed has run in all environments.
 */

import { sql, ensureSchema } from "./db";
import { fetchJson } from "./github";
import {
  SYSTEMS as LEGACY_SYSTEMS,
  MANIFEST as LEGACY_MANIFEST,
  SystemEntry,
  ManifestEntry,
} from "./manifest.generated";

// Re-export the shape types so consumers can import from one place.
export type { SystemEntry, ManifestEntry } from "./manifest.generated";

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

// ─── Scoring helpers (unchanged) ───────────────────────────────────────────

const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 .+/-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

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
  for (const v of Object.values(pr)) {
    if (typeof v === "number") return v;
  }
  return 0;
}

// ─── Legacy ↔ DB row translation ────────────────────────────────────────────

/**
 * Rebuild the legacy `Product` shape from a catalogue_items row. The shape
 * must match what the JSON files used to produce — `CatalogBrowser` iterates
 * `Object.keys(h.product)` to infer dynamic columns and relies on every
 * non-skipped key being a user-facing spec.
 */
interface CatalogueRow {
  id: number;
  vendor: string;
  category: string;
  sub_category: string | null;
  model: string;
  description: string;
  currency: string;
  price_dpp: number | string | null;
  price_si: number | string | null;
  price_end_user: number | string | null;
  specs: Record<string, unknown> | null;
}

function numOrUndef(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function rowToProduct(row: CatalogueRow): Product {
  const specs = row.specs || {};
  // Spread `specs` first so a stray legacy spec field can't overwrite a
  // normalized column.
  const base: Record<string, unknown> = { ...specs };
  // Drop bookkeeping keys that we never want surfaced in the UI.
  delete base.source_file;
  delete base.legacy_id;

  const pricing: Record<string, number> = {};
  const dpp = numOrUndef(row.price_dpp);
  const si = numOrUndef(row.price_si);
  const end = numOrUndef(row.price_end_user);
  if (dpp !== undefined) pricing.dpp = dpp;
  if (si !== undefined) pricing.si = si;
  if (end !== undefined) pricing.end_user = end;

  return {
    ...base,
    id: (specs.legacy_id as number | string | undefined) ?? row.id,
    vendor: row.vendor,
    model: row.model,
    category: row.category || undefined,
    sub_category: row.sub_category || undefined,
    description: row.description || undefined,
    pricing,
  };
}

// ─── Systems / manifest loader (Postgres with legacy fallback) ─────────────

interface SystemsCache {
  systems: SystemEntry[];
  manifest: ManifestEntry[];
  loadedAt: number;
  source: "postgres" | "legacy";
}

let _systemsCache: SystemsCache | null = null;
const SYSTEMS_TTL_MS = 60 * 1000;

async function fetchSystemsFromDb(): Promise<{
  systems: SystemEntry[];
  manifest: ManifestEntry[];
} | null> {
  try {
    await ensureSchema();
    const q = sql();
    const rows = (await q`
      select vendor,
             category,
             max(currency) as currency,
             count(*)::int as product_count
        from catalogue_items
       where active = true
       group by vendor, category
       order by vendor, category
    `) as Array<{
      vendor: string;
      category: string;
      currency: string;
      product_count: number;
    }>;
    if (rows.length === 0) return null;
    const systems: SystemEntry[] = rows.map((r, i) => ({
      id: i + 1,
      vendor: r.vendor,
      category: r.category,
      manufacturer: r.vendor,
      currency: r.currency || "USD",
      dbPath: `catalogue_items://${r.vendor}/${r.category}`,
      theoryPath: null,
      productCount: r.product_count,
      name: `${r.vendor} ${r.category}`.trim(),
    }));
    const manifest: ManifestEntry[] = systems.map((s) => ({
      path: s.dbPath,
      vendor: s.vendor,
      category: s.category,
      kind: "db" as const,
      productCount: s.productCount,
      name: s.name,
      manufacturer: s.manufacturer,
      currency: s.currency,
    }));
    return { systems, manifest };
  } catch (err) {
    console.warn(
      "catalogue_items query failed, falling back to legacy manifest:",
      (err as Error).message,
    );
    return null;
  }
}

/**
 * Cached async loader. Used by server components and route handlers in place
 * of the old sync `SYSTEMS` constant. Memoised per serverless instance with
 * a 60s TTL so typical navigation doesn't hit the DB repeatedly.
 */
export async function loadSystems(): Promise<SystemEntry[]> {
  if (
    _systemsCache &&
    Date.now() - _systemsCache.loadedAt < SYSTEMS_TTL_MS &&
    _systemsCache.source === "postgres"
  ) {
    return _systemsCache.systems;
  }
  const db = await fetchSystemsFromDb();
  if (db) {
    _systemsCache = {
      systems: db.systems,
      manifest: db.manifest,
      loadedAt: Date.now(),
      source: "postgres",
    };
    return db.systems;
  }
  // Fallback to legacy (pre-seed deploy only).
  _systemsCache = {
    systems: LEGACY_SYSTEMS,
    manifest: LEGACY_MANIFEST,
    loadedAt: Date.now(),
    source: "legacy",
  };
  return LEGACY_SYSTEMS;
}

export async function loadManifest(): Promise<ManifestEntry[]> {
  await loadSystems();
  return _systemsCache?.manifest || LEGACY_MANIFEST;
}

/** Clear the memoised systems cache — call from admin mutations. */
export function invalidateSystemsCache(): void {
  _systemsCache = null;
}

export async function findSystem(
  idOrKey: string | number,
): Promise<SystemEntry | null> {
  const systems = await loadSystems();
  if (typeof idOrKey === "number" || /^\d+$/.test(String(idOrKey))) {
    const id = Number(idOrKey);
    return systems.find((s) => s.id === id) || null;
  }
  const key = String(idOrKey).toLowerCase();
  return (
    systems.find(
      (s) =>
        `${s.vendor} ${s.category}`.toLowerCase().includes(key) ||
        s.dbPath.toLowerCase().includes(key),
    ) || null
  );
}

// ─── Load one "system" (vendor + category) ─────────────────────────────────

export async function loadSystem(system: SystemEntry): Promise<{
  db: ProductDb;
  theory: unknown | null;
}> {
  // Legacy path — we never migrated to Postgres yet.
  if (!system.dbPath.startsWith("catalogue_items://")) {
    const [db, theory] = await Promise.all([
      fetchJson<ProductDb>(system.dbPath),
      system.theoryPath
        ? fetchJson<unknown>(system.theoryPath).catch(() => null)
        : Promise.resolve(null),
    ]);
    return { db, theory };
  }

  const q = sql();
  const rows = (await q`
    select id, vendor, category, sub_category, model, description, currency,
           price_dpp, price_si, price_end_user, specs
      from catalogue_items
     where vendor = ${system.vendor}
       and category = ${system.category}
       and active = true
     order by model
  `) as CatalogueRow[];

  const products = rows.map(rowToProduct);
  const db: ProductDb = {
    database_info: {
      name: system.name,
      manufacturer: system.manufacturer,
      vendor: system.vendor,
      category: system.category,
      currency: rows[0]?.currency || system.currency || "USD",
    },
    products,
  };

  // Selection theory now lives in catalogue_theory.
  let theory: unknown | null = null;
  try {
    const theoryRows = (await q`
      select payload
        from catalogue_theory
       where vendor = ${system.vendor}
         and category = ${system.category}
       limit 1
    `) as Array<{ payload: unknown }>;
    theory = theoryRows[0]?.payload ?? null;
  } catch {
    theory = null;
  }

  return { db, theory };
}

// ─── Search scoring (unchanged signature + logic) ─────────────────────────

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
  const textTokens = expandTokens(rawTokens);
  const filters = query.filters || {};
  const scored: ScoredProduct[] = [];

  for (const p of products) {
    const reasons: string[] = [];
    let score = 0;
    const flat = flatten(p).join(" ").toLowerCase();

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

/**
 * Global cross-vendor search. Backed by a single Postgres query now — no
 * more parallel GitHub fetches. Pre-filters with a coarse `ilike` on the
 * concatenated text so we don't pull ~1000 rows for every call, then runs
 * the existing scoring loop in-memory.
 */
export async function globalSearch(
  text: string,
  limit = 80,
): Promise<Array<ScoredProduct & { system: SystemEntry }>> {
  const rawTokens = tokenize(text);
  const tokens = expandWithAliases(expandTokens(rawTokens));

  // Try Postgres first.
  let hits: Array<ScoredProduct & { system: SystemEntry }> = [];
  try {
    await ensureSchema();
    const q = sql();
    const tokenPattern =
      tokens.length > 0 ? `%${tokens.join("%")}%` : "%";
    const rows = (await q`
      select id, vendor, category, sub_category, model, description, currency,
             price_dpp, price_si, price_end_user, specs
        from catalogue_items
       where active = true
         and (
           ${tokens.length === 0}
           or (
             vendor ilike ${tokenPattern}
             or category ilike ${tokenPattern}
             or model ilike ${tokenPattern}
             or description ilike ${tokenPattern}
             or specs::text ilike ${tokenPattern}
           )
         )
       order by vendor, category, model
       limit 2000
    `) as CatalogueRow[];

    if (rows.length > 0) {
      // Group by (vendor, category) so we can attach a `system` tag.
      const systems = await loadSystems();
      const sysMap = new Map<string, SystemEntry>();
      for (const s of systems) {
        sysMap.set(`${s.vendor}::${s.category}`, s);
      }
      const dbShim: ProductDb = {
        database_info: { currency: "USD" },
        products: rows.map(rowToProduct),
      };
      const scored = searchProducts(dbShim, { text, limit: 2000 });
      for (const s of scored) {
        const vendor = String(s.product.vendor ?? "");
        const category = String(s.product.category ?? "");
        const system =
          sysMap.get(`${vendor}::${category}`) || systems[0];
        hits.push({ ...s, system });
      }
      hits.sort((a, b) => b.score - a.score);
      return hits.slice(0, limit);
    }
  } catch (err) {
    console.warn("globalSearch postgres path failed:", (err as Error).message);
  }

  // Legacy fallback: scan the in-memory manifest via github JSON fetches.
  const systems = await loadSystems();
  const ranked = systems
    .map((s) => {
      const hay = `${s.vendor} ${s.category} ${s.name} ${s.manufacturer || ""}`
        .toLowerCase();
      const sysScore = tokens.reduce(
        (acc, t) => (hay.includes(t) ? acc + 1 : acc),
        0,
      );
      return { s, sysScore };
    })
    .sort((a, b) => b.sysScore - a.sysScore);

  const perSystemLimit = Math.max(20, Math.ceil(limit / 2));
  const chunks = await Promise.all(
    ranked
      .map((r) => r.s)
      .map(async (sys) => {
        try {
          const { db } = await loadSystem(sys);
          const h = searchProducts(db, { text, limit: perSystemLimit });
          return h.map((x) => ({ ...x, system: sys }));
        } catch {
          return [] as Array<ScoredProduct & { system: SystemEntry }>;
        }
      }),
  );
  hits = chunks.flat();
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
