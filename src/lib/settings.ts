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
  /**
   * Runtime kill-switch for the CRM module (Contacts, Companies, Deals, Tasks,
   * etc.). Defaults to `false` so a fresh deploy is visually and behaviourally
   * identical to the pre-CRM app. Flipping to `true` in the admin Settings
   * tab reveals the /crm/* surface; flipping back to `false` is an instant
   * rollback — no DB changes are required.
   */
  crmModuleEnabled: boolean;
}

/** Used when the DB has no settings row yet — matches the old hardcoded values. */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultTerms: [...DEFAULT_TERMS],
  footerText:
    "Address: Amman- Gardens street- Khawaja Complex No.65- Tel: +962 65560272 Fax: +962 65560275",
  crmModuleEnabled: false,
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
    crmModuleEnabled:
      typeof v.crmModuleEnabled === "boolean"
        ? v.crmModuleEnabled
        : DEFAULT_APP_SETTINGS.crmModuleEnabled,
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
/**
 * Hard budget for the in-render DB fetch. If Supabase hasn't answered by
 * the time this fires we hand back stale cache (or the hardcoded defaults)
 * and let the real query finish in the background so the *next* request
 * gets fresh data. This is the single biggest lever for page-load latency —
 * without it, every cold-start page render on /designer and /admin was
 * blocking on ~800–1500 ms of pooler handshake + schema check + select.
 */
const SETTINGS_PRELOAD_BUDGET_MS = 400;
/**
 * Longer budget for admin-triggered `fresh: true` reads. The admin page
 * genuinely wants the newest persisted values (so the Settings form seeds
 * from the latest row rather than a 60s-stale cache), but if Supabase is
 * cold-starting or unreachable we still can't block the render forever —
 * otherwise /admin gets stuck on its loading.tsx skeleton with no timeout.
 * 3s is long enough to clear a typical pooler handshake + query, short
 * enough that the admin always sees *something* rendered.
 */
const SETTINGS_FRESH_BUDGET_MS = 3000;
/**
 * Secondary budget used only when the fresh read times out AND we have no
 * stale cache to fall back to. Without this window, a cold lambda landing
 * on /admin after a save on a sibling instance would return
 * `DEFAULT_APP_SETTINGS` (the hardcoded values), making the admin's save
 * look wiped even though it's correctly persisted in the DB. Giving the
 * already-running DB fetch a few more seconds to finish lets us render the
 * real values in the common "Supabase is cold, not dead" case, while still
 * keeping an absolute ceiling so the page can never hang indefinitely.
 */
const SETTINGS_FRESH_EXTENDED_BUDGET_MS = 5000;
const globalForSettings = globalThis as unknown as {
  __mtAppSettingsCache?: { at: number; data: AppSettings };
  __mtAppSettingsInFlight?: Promise<AppSettings>;
};

async function fetchAppSettingsFromDb(): Promise<AppSettings> {
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
}

export async function getAppSettings(
  opts: { fresh?: boolean } = {},
): Promise<AppSettings> {
  const cached = globalForSettings.__mtAppSettingsCache;
  // Admin surfaces (the /admin Settings tab) pass `fresh: true` so they
  // always reflect the latest persisted values — critical on Vercel where
  // each lambda instance has its own in-process cache. Without this,
  // saving the default terms on instance A would still render stale values
  // on the next request if it landed on instance B (cache TTL: 60s).
  if (opts.fresh) {
    // Drop any stale per-instance cache so the read below actually hits the
    // database instead of returning whatever a previous non-fresh request
    // populated. Keep the previous cache value around as a fallback for the
    // timeout path so we serve *something real* instead of defaults.
    const staleCache = cached;
    globalForSettings.__mtAppSettingsCache = undefined;
    // Share the in-flight fetch with any concurrent callers on this
    // instance (e.g. a second tab or a Designer render firing at the same
    // time) so we don't stampede the Supavisor pool with duplicate reads.
    let inflight = globalForSettings.__mtAppSettingsInFlight;
    if (!inflight) {
      inflight = fetchAppSettingsFromDb().finally(() => {
        globalForSettings.__mtAppSettingsInFlight = undefined;
      });
      globalForSettings.__mtAppSettingsInFlight = inflight;
    }
    // Swallow the background rejection so an unreachable DB doesn't
    // surface as an unhandled promise rejection on the serverless runtime.
    inflight.catch(() => {});
    // Race the DB fetch against a hard budget. Without this the admin page
    // would hang on its loading.tsx skeleton indefinitely whenever Supabase
    // was cold-starting or unreachable — the previous code awaited the
    // fetch with no timeout. The fetch still runs in the background on
    // timeout so the next request picks up the fresh value from cache.
    const timeout = new Promise<"TIMEOUT">((resolve) =>
      setTimeout(() => resolve("TIMEOUT"), SETTINGS_FRESH_BUDGET_MS),
    );
    try {
      const result = await Promise.race([inflight, timeout]);
      if (result !== "TIMEOUT") return result;
    } catch {
      return staleCache?.data ?? { ...DEFAULT_APP_SETTINGS };
    }
    // Primary budget exhausted. A stale cache from an earlier request on
    // this same instance is almost always correct (it's a copy of the DB
    // row we just tried to re-read), so prefer it over the hardcoded
    // defaults — serving defaults here is exactly the bug that makes the
    // admin's save look wiped after a reload lands on a cold lambda.
    if (staleCache?.data) return staleCache.data;
    // No stale cache — we MUST wait for the real DB read rather than
    // falling back to DEFAULT_APP_SETTINGS. Serving defaults here is what
    // made the admin think their saves were lost: the /admin page would
    // seed the form from hardcoded defaults, a subsequent save would merge
    // the admin's patch over defaults, and after reload the cycle would
    // repeat. The admin page is rare and already tolerates a slow load —
    // block on the real query instead of serving a lie.
    try {
      return await inflight;
    } catch {
      return { ...DEFAULT_APP_SETTINGS };
    }
  }
  if (cached && Date.now() - cached.at < SETTINGS_CACHE_TTL_MS) {
    return cached.data;
  }

  // Coalesce concurrent requests — if another render is already asking the
  // DB, piggyback on that promise instead of opening a second connection.
  let inflight = globalForSettings.__mtAppSettingsInFlight;
  if (!inflight) {
    inflight = fetchAppSettingsFromDb().finally(() => {
      globalForSettings.__mtAppSettingsInFlight = undefined;
    });
    globalForSettings.__mtAppSettingsInFlight = inflight;
  }

  // Swallow any rejection on the background copy so unhandled-rejection
  // noise doesn't escape into Next's dev overlay when the DB is down.
  // The shared `inflight` we `race` against still surfaces the error below.
  inflight.catch(() => {});

  const timeout = new Promise<"TIMEOUT">((resolve) =>
    setTimeout(() => resolve("TIMEOUT"), SETTINGS_PRELOAD_BUDGET_MS),
  );

  try {
    const result = await Promise.race([inflight, timeout]);
    if (result === "TIMEOUT") {
      // DB is slow — serve whatever we have without blocking the page.
      // The background fetch will update the cache for the next request.
      return cached?.data ?? { ...DEFAULT_APP_SETTINGS };
    }
    return result;
  } catch {
    // On a query error fall back to stale cache if we have one, otherwise
    // the hardcoded defaults. Never throw — callers embed this in render
    // paths that must not hard-fail the whole page.
    return cached?.data ?? { ...DEFAULT_APP_SETTINGS };
  }
}

export async function saveAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  await ensureSchema();
  const q = sql();
  // Read the current row with a DIRECT query — no cache, no timeout race.
  // `getAppSettings({fresh:true})` races against a 3s budget and falls back
  // to DEFAULT_APP_SETTINGS when the DB is slow, which meant a cold-lambda
  // save would merge the admin's patch over defaults and silently clobber
  // whatever was actually persisted. Writes must always see the real row.
  const currentRows = (await q`
    select value from app_settings where key = ${KEY} limit 1
  `) as Array<{ value: unknown }>;
  const current = currentRows[0]
    ? normalize(currentRows[0].value)
    : { ...DEFAULT_APP_SETTINGS };
  const next = normalize({ ...current, ...patch });
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
  // An in-flight fetch started before this write would otherwise win the
  // race and repopulate the cache with the pre-write value. Drop it so the
  // next getAppSettings() either serves our fresh cache or opens its own
  // query.
  globalForSettings.__mtAppSettingsInFlight = undefined;
  return saved;
}
