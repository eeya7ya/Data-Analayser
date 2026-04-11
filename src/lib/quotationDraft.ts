// Shared localStorage-backed draft for the manual quotation flow.
// The catalog pushes items into this draft, and the designer reads/edits it
// live — so clicking "+" on any product lands directly in the designer table.

import type {
  QuotationItem,
  QuotationExtraColumn,
} from "@/components/QuotationPreview";

/** Pricing category determines the factor applied to SI (base) prices. */
export type PricingCategory = "si" | "dpp" | "end_user" | "manual";

/** Factor multiplied against the SI base price for each category. */
export const PRICING_FACTORS: Record<Exclude<PricingCategory, "manual">, number> = {
  si: 1,
  dpp: 0.965,
  end_user: 1.05,
};

export const PRICING_LABELS: Record<PricingCategory, string> = {
  si: "SI (System Installer)",
  dpp: "DPP (Distributor Partner)",
  end_user: "End User",
  manual: "Manual Pricing",
};

export const DEFAULT_TERMS: string[] = [
  "Validity: 1 week from the date of the offer.",
  "Total cost include TAX and custom fees",
  "Quotation price doesn't mean quantity reservation",
  "Warranty: 1 year warranty for CCTV",
  "Method of payments: 70% down payment & 30% upon items delivery",
  "TBD = to be determined",
  "Offer include all installation, and accessories for the first camera only",
];

export interface QuotationDraft {
  items: QuotationItem[];
  projectName: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  salesEng: string;
  salesPhone: string;
  preparedBy: string;
  refCode: string;
  siteName: string;
  taxPercent: number;
  showPictures: boolean;
  terms: string[];
  /** User-added manual columns shared across every system table. */
  extraColumns: QuotationExtraColumn[];
  /** Optional custom project-scope paragraph shown above Final Totals. */
  scopeIntro: string;
  /**
   * Dedicated design / presales engineer name — pre-filled from the
   * per-user preference so the user only has to type it once.
   */
  designEng: string;
  /** Active pricing category — determines the factor applied to SI prices. */
  pricingCategory: PricingCategory;
  /** Whether tax is included in the total cost. */
  includeTax: boolean;
  /** Whether entered prices already include tax (back-calculate base). */
  taxInclusive: boolean;
}

// Legacy per-browser "last Design Engineer name" key. We used to remember
// this across quotations so users only typed it once, but the key was shared
// across every logged-in user on the same browser — which meant an admin
// opening the Designer would see a previous user's name under "Presales
// Engineer". The Designer now always defaults to the logged-in user's
// display_name instead; this constant is only kept so `loadDraft` can scrub
// the stale value out of any existing localStorage entries from before the
// fix landed.
const LEGACY_PREF_DESIGN_ENG = "mt_design_engineer_v1";

function clearLegacyDesignEngineerPref(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_PREF_DESIGN_ENG);
  } catch {
    /* ignore */
  }
}

// ── Editing context ─────────────────────────────────────────────────────────
// Remembers which saved quotation (if any) the user is currently editing so
// that /catalog can route its "Open designer" button back to the correct
// /designer?id=<X> page instead of accidentally starting a new quotation.
const EDITING_QUOTATION_KEY = "mt_editing_quotation_v1";

export interface EditingContext {
  id: number;
  ref: string;
  projectName: string;
}

export function loadEditingContext(): EditingContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(EDITING_QUOTATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EditingContext>;
    if (typeof parsed.id !== "number" || !Number.isFinite(parsed.id)) {
      return null;
    }
    return {
      id: parsed.id,
      ref: typeof parsed.ref === "string" ? parsed.ref : "",
      projectName:
        typeof parsed.projectName === "string" ? parsed.projectName : "",
    };
  } catch {
    return null;
  }
}

export function saveEditingContext(ctx: EditingContext | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!ctx) {
      window.localStorage.removeItem(EDITING_QUOTATION_KEY);
      return;
    }
    window.localStorage.setItem(EDITING_QUOTATION_KEY, JSON.stringify(ctx));
  } catch {
    /* ignore */
  }
}

const STORAGE_KEY = "mt_quotation_draft_v1";

export function emptyDraft(): QuotationDraft {
  return {
    items: [],
    projectName: "",
    clientName: "",
    clientEmail: "",
    clientPhone: "",
    salesEng: "ENG. Yahya Khaled",
    salesPhone: "+962 795172566",
    preparedBy: "",
    refCode: "",
    siteName: "",
    taxPercent: 16,
    showPictures: false,
    // Empty by default so the Designer falls back to the admin-edited
    // defaults from the server (`adminDefaultTerms`) instead of the
    // built-in hardcoded list. See Designer.tsx hydration for the
    // `d.terms.length > 0 ? d.terms : adminDefaultTerms` switch.
    terms: [],
    extraColumns: [],
    scopeIntro: "",
    // Presales Engineer is resolved by the Designer against the logged-in
    // `SessionUser` at render time so it always tracks the current account,
    // not whoever last typed a name on this browser.
    designEng: "",
    pricingCategory: "si",
    includeTax: true,
    taxInclusive: false,
  };
}

/**
 * Detect a stored `terms` array that is a verbatim copy of the old built-in
 * DEFAULT_TERMS. Callers use this to decide whether the stored list is just
 * a stale pre-admin-Settings snapshot that should yield to the current
 * admin-edited presets, instead of masquerading as a "user customisation".
 *
 * Used in two places:
 *   1. `loadDraft()` below — clears the localStorage draft's terms so new
 *      quotations inherit the admin defaults.
 *   2. Designer / QuotationViewer — saved quotations whose stamped terms
 *      still match the pre-admin defaults fall back to adminDefaultTerms
 *      instead of the old hardcoded list.
 */
export function termsMatchBuiltInDefault(terms: unknown): boolean {
  if (!Array.isArray(terms)) return false;
  if (terms.length !== DEFAULT_TERMS.length) return false;
  return terms.every((t, i) => t === DEFAULT_TERMS[i]);
}

export function loadDraft(): QuotationDraft {
  if (typeof window === "undefined") return emptyDraft();
  // One-shot purge of the stale cross-user Presales Engineer pref.
  clearLegacyDesignEngineerPref();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw) as Partial<QuotationDraft>;
    const merged = { ...emptyDraft(), ...parsed };
    // Discard stale cached defaults so the admin-edited presets win.
    if (termsMatchBuiltInDefault(merged.terms)) {
      merged.terms = [];
    }
    // Never carry a previous user's Presales Engineer name out of a cached
    // draft — the Designer fills this in from the logged-in `SessionUser`.
    merged.designEng = "";
    return merged;
  } catch {
    return emptyDraft();
  }
}

export function saveDraft(draft: QuotationDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* ignore quota errors */
  }
}

export function clearDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Append a catalog item to the draft (dedupes on system + model, bumps qty). */
export function appendItem(newItem: QuotationItem): QuotationDraft {
  const draft = loadDraft();
  const key = `${newItem.system}__${newItem.model}`;
  const idx = draft.items.findIndex(
    (it) => `${it.system}__${it.model}` === key,
  );
  if (idx >= 0) {
    draft.items[idx] = {
      ...draft.items[idx],
      quantity: draft.items[idx].quantity + newItem.quantity,
    };
  } else {
    draft.items.push({ ...newItem, no: draft.items.length + 1 });
  }
  // Renumber to keep "no" contiguous.
  draft.items = draft.items.map((it, i) => ({ ...it, no: i + 1 }));
  saveDraft(draft);
  return draft;
}
