import { sql, ensureSchema } from "./db";
import { DEFAULT_TERMS } from "./quotationDraft";

/**
 * Global, admin-editable presets for every printable quotation.
 *
 * - `defaultTerms` populates the Terms and Conditions block whenever a new
 *   quotation is created or a saved quotation has no stored terms.
 * - `footerText` is rendered at the bottom of every printable sheet.
 * - `crmModuleEnabled` is the runtime kill-switch for /crm/*.
 */
export interface AppSettings {
  defaultTerms: string[];
  footerText: string;
  crmModuleEnabled: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultTerms: [...DEFAULT_TERMS],
  footerText:
    "Address: Amman- Gardens street- Khawaja Complex No.65- Tel: +962 65560272 Fax: +962 65560275",
  crmModuleEnabled: false,
};

const KEY = "global";

/**
 * Coerce a persisted row into an AppSettings shape. Only fills in defaults
 * for fields that are MISSING or the wrong type — an empty string or empty
 * array is a legitimate admin choice and must be preserved, otherwise the
 * admin has no way to clear a value.
 *
 * Handles the case where the jsonb column comes back as a raw JSON STRING
 * rather than a parsed object. Under `prepare: false` (mandatory for the
 * Supabase transaction pooler), postgres.js can't introspect the column
 * type and occasionally surfaces jsonb as text — this is the same
 * normalisation QuotationViewer applies to `items_json` / `config_json`.
 * Without this unwrap, every settings read returned all-defaults on the
 * serverless deploy, which is why the Save toast flashed "Saved." and the
 * form immediately re-seeded to CRM=off / built-in terms.
 */
function normalize(value: unknown): AppSettings {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  const v = (raw ?? {}) as Partial<AppSettings>;
  return {
    defaultTerms: Array.isArray(v.defaultTerms)
      ? v.defaultTerms.map((t) => String(t ?? ""))
      : [...DEFAULT_APP_SETTINGS.defaultTerms],
    footerText:
      typeof v.footerText === "string"
        ? v.footerText
        : DEFAULT_APP_SETTINGS.footerText,
    crmModuleEnabled:
      typeof v.crmModuleEnabled === "boolean"
        ? v.crmModuleEnabled
        : DEFAULT_APP_SETTINGS.crmModuleEnabled,
  };
}

// Tiny per-process cache so a single request's multiple settings reads
// (Designer + QuotationViewer + layout gate) don't each hit the DB. Short
// TTL so admin edits propagate across warm lambdas within seconds.
const CACHE_TTL_MS = 5_000;
// Hard ceiling on a single DB read. With postgres `max: 1` + transaction
// pooler, a hung query on another request serialises behind this one, so
// we cannot afford to wait indefinitely — the CRM layout gate calls into
// here on every /crm/* navigation and an indefinite wait froze the whole
// module ("nothing loads, navigation is dead"). On timeout we serve the
// last cached value if we have one; otherwise we assume DEFAULTS and let
// the real fetch finish in the background for the next request.
const READ_TIMEOUT_MS = 8_000;
const globalForSettings = globalThis as unknown as {
  __mtAppSettingsCache?: { at: number; data: AppSettings };
  __mtAppSettingsInFlight?: Promise<AppSettings>;
};

async function queryDb(): Promise<AppSettings> {
  await ensureSchema();
  const q = sql();
  const rows = (await q`
    select value from app_settings where key = ${KEY} limit 1
  `) as Array<{ value: unknown }>;
  const data =
    rows.length === 0 ? { ...DEFAULT_APP_SETTINGS } : normalize(rows[0].value);
  globalForSettings.__mtAppSettingsCache = { at: Date.now(), data };
  return data;
}

function readFromDb(): Promise<AppSettings> {
  // Coalesce concurrent callers onto a single in-flight query so the CRM
  // layout + the analytics endpoint + /api/crm/status pounding this on
  // the same cold lambda don't each open a fresh round-trip.
  let inflight = globalForSettings.__mtAppSettingsInFlight;
  if (!inflight) {
    inflight = queryDb().finally(() => {
      globalForSettings.__mtAppSettingsInFlight = undefined;
    });
    globalForSettings.__mtAppSettingsInFlight = inflight;
  }
  // Swallow the background rejection so unhandled-rejection noise doesn't
  // leak out; the raced copy below still surfaces errors to the caller.
  inflight.catch(() => {});
  return inflight;
}

/**
 * Returns the current app settings. `fresh: true` skips the in-process
 * cache so the admin Settings tab always seeds from the latest persisted
 * row (critical on Vercel where each lambda keeps its own cache).
 *
 * Reads race against an 8s timeout. If the query is still outstanding we
 * hand back the last-known cache (or defaults, if none exists) and let
 * the background fetch populate the cache for the next request. This is
 * the "wait, but never wait forever" shape — the earlier 400ms timeout
 * lied to callers on every cold start, and removing the timeout entirely
 * deadlocked /crm/* on a slow pooler.
 */
export async function getAppSettings(
  opts: { fresh?: boolean } = {},
): Promise<AppSettings> {
  const cached = globalForSettings.__mtAppSettingsCache;
  if (!opts.fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }
  const inflight = readFromDb();
  const timeout = new Promise<"TIMEOUT">((resolve) =>
    setTimeout(() => resolve("TIMEOUT"), READ_TIMEOUT_MS),
  );
  try {
    const result = await Promise.race([inflight, timeout]);
    if (result !== "TIMEOUT") return result;
  } catch {
    return cached?.data ?? { ...DEFAULT_APP_SETTINGS };
  }
  return cached?.data ?? { ...DEFAULT_APP_SETTINGS };
}

/**
 * Upsert the global settings row with a partial patch and return the
 * row PostgreSQL actually wrote. Throws if the upsert no-ops (e.g. the
 * jsonb cast rejected the payload) so the admin never sees a false
 * "Saved." toast.
 */
export async function saveAppSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  await ensureSchema();
  const q = sql();
  const currentRows = (await q`
    select value from app_settings where key = ${KEY} limit 1
  `) as Array<{ value: unknown }>;
  const current = currentRows[0]
    ? normalize(currentRows[0].value)
    : { ...DEFAULT_APP_SETTINGS };
  const next = normalize({ ...current, ...patch });
  const json = JSON.stringify(next);
  const rows = (await q`
    insert into app_settings (key, value, updated_at)
    values (${KEY}, ${json}::jsonb, now())
    on conflict (key) do update
      set value = excluded.value,
          updated_at = now()
    returning value
  `) as Array<{ value: unknown }>;
  if (rows.length === 0) {
    throw new Error(
      "app_settings upsert did not return a row — the database rejected the payload",
    );
  }
  const saved = normalize(rows[0].value);
  globalForSettings.__mtAppSettingsCache = { at: Date.now(), data: saved };
  return saved;
}
