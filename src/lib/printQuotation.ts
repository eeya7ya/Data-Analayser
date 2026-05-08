import { buildPrintTitle, type PrintKind } from "./printFilename";

export type { PrintKind };

export interface RunPrintOptions {
  ref?: string | null;
  projectName?: string | null;
  kind: PrintKind;
  /**
   * Optional state-flip hook fired before opening the print dialog. Used by
   * callers that need to commit a React state change (e.g. read-only mode,
   * BoQ mode) into the DOM before the browser captures the page. Returning
   * a promise lets the caller await a render frame; the helper still waits
   * its own animation frame regardless so React has time to flush.
   */
  beforePrint?: () => void | Promise<void>;
  /**
   * Restore hook fired after the print dialog closes (or returns
   * synchronously, on Chrome). Use for clearing transient print state.
   */
  afterPrint?: () => void;
}

/**
 * Single entry point for every Print / Print Draft / Print BOQ button in the
 * app. Centralising this:
 *   - guarantees the same page-header (logo strip) and page-footer (address
 *     bar) repeat on every printed page regardless of which button was used,
 *   - sets `document.title` so the browser's "Save as PDF" dialog suggests
 *     "<REF> - <Project>[ - Draft|BoQ]" instead of the raw URL,
 *   - toggles `body.print-draft` so the @media print CSS hides the
 *     full-bleed cover/about sheets for draft and BoQ prints,
 *   - cleans up on `afterprint` and on the next animation frame (Chrome
 *     returns synchronously from window.print()).
 */
export function runQuotationPrint(opts: RunPrintOptions): void {
  if (typeof window === "undefined") return;
  const { ref, projectName, kind, beforePrint, afterPrint } = opts;

  const previousTitle = document.title;
  const hideCover = kind === "draft" || kind === "boq";
  if (hideCover) document.body.classList.add("print-draft");
  document.title = buildPrintTitle(ref, projectName, kind);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.title = previousTitle;
    document.body.classList.remove("print-draft");
    window.removeEventListener("afterprint", cleanup);
    afterPrint?.();
  };
  window.addEventListener("afterprint", cleanup);

  const fire = () => {
    window.requestAnimationFrame(() => {
      try {
        window.print();
      } finally {
        cleanup();
      }
    });
  };

  const result = beforePrint?.();
  if (result && typeof (result as Promise<void>).then === "function") {
    (result as Promise<void>).then(fire, () => {
      cleanup();
    });
  } else {
    fire();
  }
}
