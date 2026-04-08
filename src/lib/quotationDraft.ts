// Shared localStorage-backed draft for the manual quotation flow.
// The catalog pushes items into this draft, and the designer reads/edits it
// live — so clicking "+" on any product lands directly in the designer table.

import type {
  QuotationItem,
  QuotationExtraColumn,
} from "@/components/QuotationPreview";

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
}

// Per-user preference keys that survive individual draft resets so the
// fields only need to be filled in once.
const PREF_DESIGN_ENG = "mt_design_engineer_v1";

export function loadDesignEngineerPref(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(PREF_DESIGN_ENG) || "";
  } catch {
    return "";
  }
}

export function saveDesignEngineerPref(value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value && value.trim()) {
      window.localStorage.setItem(PREF_DESIGN_ENG, value.trim());
    } else {
      window.localStorage.removeItem(PREF_DESIGN_ENG);
    }
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
    terms: [...DEFAULT_TERMS],
    extraColumns: [],
    scopeIntro: "",
    designEng: loadDesignEngineerPref(),
  };
}

export function loadDraft(): QuotationDraft {
  if (typeof window === "undefined") return emptyDraft();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw) as Partial<QuotationDraft>;
    return { ...emptyDraft(), ...parsed };
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
