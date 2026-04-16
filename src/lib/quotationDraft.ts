// Shared localStorage-backed draft for the manual quotation flow.
// The catalog pushes items into this draft, and the designer reads/edits it
// live — so clicking "+" on any product lands directly in the designer table.

import type {
  QuotationItem,
  QuotationExtraColumn,
} from "@/components/QuotationPreview";
import { DEFAULT_BRAND_VARIANT_ID } from "@/lib/brandVariants";

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
  /**
   * User-chosen multiplier applied to SI base prices when the pricing
   * category is "manual". A factor of 1 leaves prices untouched, 1.5
   * marks them up 50 %, 0.98 discounts them 2 %, etc. Ignored by the
   * preset SI / DPP / End-user categories.
   */
  manualFactor: number;
  /** Whether tax is included in the total cost. */
  includeTax: boolean;
  /** Whether entered prices already include tax (back-calculate base). */
  taxInclusive: boolean;
  /**
   * Client folder id selected in the Designer. Persisting this means the
   * user's client selection survives a page refresh — without it the
   * Designer drops back into its "pick a client" hero every time the
   * browser tab reloads, wiping any in-progress draft from view.
   */
  folderId: number | null;
  /**
   * Id of the brand variant whose logo / cover / about-us artwork drives
   * this quotation's printed output. Defaults to the original Magic Tech
   * bundle so drafts saved before variants existed keep rendering their
   * exact pre-variant look.
   */
  brandVariantId: string;
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
// Remembers which quotation the user is currently working on so /catalog can
// route its "Back" button to the right /designer instance. Two shapes:
//   • id > 0            → editing a saved quotation, return to /designer?id=X
//   • id === 0 & folder → composing a new quotation anchored on a client
//                         folder, return to /designer?folder=Y&new=1
// Without the create-mode shape, opening the catalogue from a brand-new
// quotation and clicking "Back" routed to /designer (no query string), which
// the designer page gate bounces straight to /quotation — dropping every
// in-flight client / item the user had set up.
const EDITING_QUOTATION_KEY = "mt_editing_quotation_v1";

export interface EditingContext {
  id: number;
  ref: string;
  projectName: string;
  /**
   * Client folder the in-flight quotation belongs to. Populated for both
   * edit mode (mirrors `existing.folder_id`) and create mode (mirrors the
   * Designer's `folderId` state) so the catalogue can always return the
   * user to the right parent in the client → quotation → design chain.
   */
  folderId?: number | null;
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
    const folderId =
      typeof parsed.folderId === "number" && Number.isFinite(parsed.folderId)
        ? parsed.folderId
        : null;
    // A context with id === 0 is only useful if we also know the parent
    // folder to route back to — otherwise the catalogue back button has
    // nothing to open. Drop such records so callers fall through to the
    // generic /designer route instead of a broken create-mode anchor.
    if (parsed.id === 0 && folderId == null) return null;
    return {
      id: parsed.id,
      ref: typeof parsed.ref === "string" ? parsed.ref : "",
      projectName:
        typeof parsed.projectName === "string" ? parsed.projectName : "",
      folderId,
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
    // Sales engineer used to default to a hardcoded name ("ENG. Yahya
    // Khaled"), which meant every new quotation came out branded as that
    // person regardless of who was logged in. The Designer now resolves
    // the default against the current `SessionUser` at render time (see
    // `setSalesEng(user.display_name || user.username)` below), so we
    // leave this blank here and rely on the loader to seed it.
    salesEng: "",
    salesPhone: "",
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
    manualFactor: 1,
    includeTax: true,
    taxInclusive: false,
    folderId: null,
    brandVariantId: DEFAULT_BRAND_VARIANT_ID,
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
    // Same story for the Sales Engineer field, which used to be seeded
    // with a hardcoded name. Any stored value that still matches that
    // legacy default is scrubbed so the Designer can re-seed it from the
    // logged-in user's display name.
    if (merged.salesEng === "ENG. Yahya Khaled") {
      merged.salesEng = "";
    }
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

// ── Per-quotation edit-mode draft ──────────────────────────────────────────
// The main draft (above) only backs the "new quotation" flow. When the user
// is editing an already-saved quotation via `/designer?id=X`, we used to
// skip localStorage entirely and rely on the explicit "Save updates" button
// — so any unsaved changes (including terms edits) were wiped on refresh.
// This per-id draft gives edit mode the same "you won't lose your work"
// behaviour as create mode without mixing the two streams: the keys are
// disjoint from `mt_quotation_draft_v1` and each quotation gets its own
// slot, so opening a second saved quotation never resurrects the first
// one's in-progress edits.

const EDIT_DRAFT_PREFIX = "mt_quotation_edit_draft_v1_";

function editDraftKey(id: number): string {
  return `${EDIT_DRAFT_PREFIX}${id}`;
}

export interface EditModeDraft {
  items: QuotationItem[];
  terms: string[];
  extraColumns: QuotationExtraColumn[];
  scopeIntro: string;
  designEng: string;
  pricingCategory: PricingCategory;
  manualFactor: number;
  includeTax: boolean;
  taxInclusive: boolean;
  projectName: string;
  siteName: string;
  showPictures: boolean;
  taxPercent: number;
  /** Selected brand variant id (logo + cover + about-us bundle). */
  brandVariantId?: string;
}

export function loadEditDraft(id: number): EditModeDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(editDraftKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as EditModeDraft;
  } catch {
    return null;
  }
}

export function saveEditDraft(id: number, draft: EditModeDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(editDraftKey(id), JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

export function clearEditDraft(id: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(editDraftKey(id));
  } catch {
    /* ignore */
  }
}

/**
 * Mirror the Designer's current tax-toggle state into the shared draft so
 * `appendItem` — which runs from /catalog and only has access to this one
 * localStorage key — knows whether to pre-divide the new row.
 *
 * Called from both create-mode (where `saveDraft` already carries these
 * fields) and edit-mode (where the per-id `saveEditDraft` is the source of
 * truth and the shared draft would otherwise be stale from a previous
 * new-quotation session). Only these two fields are touched so the rest of
 * the shared draft (items, header, terms, …) is left exactly as-is.
 */
export function syncDraftTaxContext(
  taxInclusive: boolean,
  taxPercent: number,
): void {
  if (typeof window === "undefined") return;
  try {
    const draft = loadDraft();
    draft.taxInclusive = taxInclusive;
    draft.taxPercent =
      Number.isFinite(taxPercent) && taxPercent >= 0 ? taxPercent : draft.taxPercent;
    saveDraft(draft);
  } catch {
    /* ignore */
  }
}

/** Append a catalog item to the draft (dedupes on system + model, bumps qty). */
export function appendItem(newItem: QuotationItem): QuotationDraft {
  const draft = loadDraft();
  // Catalog prices come in tax-inclusive (the SI base already carries
  // the tax). If the draft is currently in "Excl. Tax" mode, the rest of
  // the rows have already been divided by (1 + taxPercent/100) by
  // Designer.toggleTaxInclusive — so we must divide this new row once on
  // insert, otherwise the user ends up with a mix of inclusive and
  // exclusive unit prices in the same table, and flipping the toggle
  // back multiplies the raw row by 1.16 a second time.
  const rate = (Number(draft.taxPercent) || 0) / 100;
  const normalized: QuotationItem =
    draft.taxInclusive && rate > 0
      ? {
          ...newItem,
          unit_price: Number(
            ((Number(newItem.unit_price) || 0) / (1 + rate)).toFixed(2),
          ),
          price_si:
            newItem.price_si != null
              ? Number(
                  ((Number(newItem.price_si) || 0) / (1 + rate)).toFixed(2),
                )
              : newItem.price_si,
        }
      : newItem;
  const key = `${normalized.system}__${normalized.model}`;
  const idx = draft.items.findIndex(
    (it) => `${it.system}__${it.model}` === key,
  );
  if (idx >= 0) {
    draft.items[idx] = {
      ...draft.items[idx],
      quantity: draft.items[idx].quantity + normalized.quantity,
    };
  } else {
    draft.items.push({ ...normalized, no: 0 });
  }
  // Renumber per-system group — each system's table counts independently
  // from 1, so appending a CCTV row doesn't bump the Sound rows' numbers.
  const perSystem = new Map<string, number>();
  draft.items = draft.items.map((it) => {
    const key = it.system || it.brand || "General";
    const next = (perSystem.get(key) ?? 0) + 1;
    perSystem.set(key, next);
    return { ...it, no: next };
  });
  saveDraft(draft);
  return draft;
}
