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
 */
function normalize(value: unknown): AppSettings {
  const v = (value ?? {}) as Partial<AppSettings>;
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
const globalForSettings = globalThis as unknown as {
  __mtAppSettingsCache?: { at: number; data: AppSettings };
};

async function readFromDb(): Promise<AppSettings> {
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

/**
 * Returns the current app settings. `fresh: true` skips the in-process
 * cache so the admin Settings tab always seeds from the latest persisted
 * row (critical on Vercel where each lambda keeps its own cache).
 *
 * There is no timeout race here. The previous implementation fell back to
 * DEFAULT_APP_SETTINGS when Supabase took longer than 400 ms, which
 * silently disabled the CRM module on cold lambdas even after an admin
 * had enabled it — the exact "CRM feature not applied no matter what I
 * press" bug. Settings reads are tiny; we'd rather wait than lie.
 */
export async function getAppSettings(
  opts: { fresh?: boolean } = {},
): Promise<AppSettings> {
  if (!opts.fresh) {
    const cached = globalForSettings.__mtAppSettingsCache;
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
  }
  return readFromDb();
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
