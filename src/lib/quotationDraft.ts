// Shared localStorage-backed draft for the manual quotation flow.
// The catalog pushes items into this draft, and the designer reads/edits it
// live — so clicking "+" on any product lands directly in the designer table.

import type { QuotationItem } from "@/components/QuotationPreview";

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
