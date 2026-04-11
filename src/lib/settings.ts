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

export async function getAppSettings(): Promise<AppSettings> {
  try {
    await ensureSchema();
    const q = sql();
    const rows = (await q`
      select value from app_settings where key = ${KEY} limit 1
    `) as Array<{ value: unknown }>;
    if (rows.length === 0) return { ...DEFAULT_APP_SETTINGS };
    return normalize(rows[0].value);
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

export async function saveAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  await ensureSchema();
  const current = await getAppSettings();
  const next = normalize({ ...current, ...patch });
  const q = sql();
  const json = JSON.stringify(next);
  await q`
    insert into app_settings (key, value, updated_at)
    values (${KEY}, ${json}::jsonb, now())
    on conflict (key) do update
      set value = excluded.value,
          updated_at = now()
  `;
  return next;
}
