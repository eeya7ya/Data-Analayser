// Builds the document.title string used as the suggested "Save as PDF" filename
// when the user runs window.print(). Browsers (Chrome/Edge/Firefox) derive the
// download name directly from document.title, so setting it just before
// window.print() is the only knob we have — there is no DOM API to set the
// PDF filename explicitly. Safari ignores this and falls back to the URL.

export type PrintKind = "normal" | "draft" | "boq";

const SUFFIX: Record<PrintKind, string> = {
  normal: "",
  draft: " - Draft",
  boq: " - BoQ",
};

/**
 * Strip characters that Windows/macOS/Linux file systems reject in download
 * names, collapse whitespace, and cap the length so the print dialog doesn't
 * truncate awkwardly mid-word.
 */
function sanitize(part: string): string {
  return part
    .replace(/[\\/:*?"<>|\r\n\t]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Produce "<REF> - <Project>[ - Draft|BoQ]". Falls back gracefully when one
 * field is missing so the dialog never shows a bare "-" or empty title.
 */
export function buildPrintTitle(
  ref: string | null | undefined,
  projectName: string | null | undefined,
  kind: PrintKind = "normal",
): string {
  const r = sanitize(ref || "");
  const p = sanitize(projectName || "");
  const base = r && p ? `${r} - ${p}` : r || p || "Quotation";
  const full = `${base}${SUFFIX[kind]}`;
  return full.length > 120 ? full.slice(0, 120).trimEnd() : full;
}

