import { sql, ensureSchema } from "./db";
import { DEFAULT_TERMS } from "./quotationDraft";

/**
 * Global, admin-editable presets for every printable quotation.
 *
 * - `defaultTerms` populates the Terms and Conditions block whenever a new
 *   quotation is created or a saved quotation has no stored terms.
 * - `footerText` is rendered at the bottom of every printable sheet
 *   (QuotationPreview footer-address band). Historically this was the
 *   hardcoded company address; it's now admin-editable.
 */
export interface AppSettings {
  defaultTerms: string[];
  footerText: string;
}

/** Used when the DB has no settings row yet — matches the old hardcoded values. */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultTerms: [...DEFAULT_TERMS],
  footerText:
    "Address: Amman- Gardens street- Khawaja Complex No.65- Tel: +962 65560272 Fax: +962 65560275",
};

const KEY = "global";

function normalize(value: unknown): AppSettings {
  const v = (value ?? {}) as Partial<AppSettings>;
  return {
    defaultTerms:
      Array.isArray(v.defaultTerms) && v.defaultTerms.length > 0
        ? v.defaultTerms.map(String)
        : [...DEFAULT_APP_SETTINGS.defaultTerms],
    footerText:
      typeof v.footerText === "string" && v.footerText.trim().length > 0
        ? v.footerText
        : DEFAULT_APP_SETTINGS.footerText,
  };
}

/**
 * In-process cache so /designer, /quotation?id=N and /admin don't each
 * pay for a `select value from app_settings` round-trip on every request.
 * Settings are only written from the admin UI; `saveAppSettings` busts
 * the cache so admins still see their own edits immediately.
 *
 * Kept on `globalThis` so Next's HMR in dev and warm Vercel lambdas both
 * reuse the same entry across requests.
 */
const SETTINGS_CACHE_TTL_MS = 60_000;
const globalForSettings = globalThis as unknown as {
  __mtAppSettingsCache?: { at: number; data: AppSettings };
};

export async function getAppSettings(): Promise<AppSettings> {
  const cached = globalForSettings.__mtAppSettingsCache;
  if (cached && Date.now() - cached.at < SETTINGS_CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    await ensureSchema();
    const q = sql();
    const rows = (await q`
      select value from app_settings where key = ${KEY} limit 1
    `) as Array<{ value: unknown }>;
    const data =
      rows.length === 0
        ? { ...DEFAULT_APP_SETTINGS }
        : normalize(rows[0].value);
    globalForSettings.__mtAppSettingsCache = { at: Date.now(), data };
    return data;
  } catch {
    // On a query error fall back to stale cache if we have one, otherwise
    // the hardcoded defaults. Never throw — callers embed this in render
    // paths that must not hard-fail the whole page.
    return cached?.data ?? { ...DEFAULT_APP_SETTINGS };
  }
}

export async function saveAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  await ensureSchema();
  const current = await getAppSettings();
  const next = normalize({ ...current, ...patch });
  const q = sql();
  const json = JSON.stringify(next);
  // Use RETURNING so we read back the row PostgreSQL actually wrote. If the
  // insert silently no-ops (e.g. the jsonb cast rejects the payload), the
  // returned array is empty and we throw instead of returning stale data.
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
  // Bust the cache so the next getAppSettings() call picks up the edit
  // instead of serving the old copy for up to a minute.
  globalForSettings.__mtAppSettingsCache = { at: Date.now(), data: saved };
  return saved;
}
