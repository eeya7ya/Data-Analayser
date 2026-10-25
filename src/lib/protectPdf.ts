/**
 * Turn a printed PDF into the read-only copy that goes to a client (browser
 * only — nothing is uploaded).
 *
 *   1. Every page is rendered to a 200 dpi image and the watermark is drawn
 *      onto it, then the PDF is rebuilt from those images. The mark is part of
 *      the pixels and there is no text left to copy or edit, so even a tool
 *      that strips the lock below can't remove it.
 *   2. AES-256 encryption (ISO 32000-2, `/V 5 /R 6`) with print-only
 *      permissions: no editing, no copying, no annotations, no page
 *      extraction. The owner password is random and thrown away, so nobody —
 *      us included — can lift the restrictions; the app simply regenerates
 *      the file when a change is needed.
 *   3. Optional open password: the file can't be opened at all without it.
 *
 * Input is the PDF the browser's own "Save as PDF" produced, so the pages are
 * exactly the printed quotation.
 */

import {
  drawWatermark,
  loadWatermarkLogo,
  type WatermarkInfo,
} from "@/lib/watermark";

export interface ProtectPdfOptions {
  /** Password the reader must type to open the file. Empty = opens freely. */
  openPassword?: string;
  /** Recipient / REF / date carried by the watermark. */
  watermark: WatermarkInfo;
  /** Document title stored in the (encrypted) PDF properties. */
  title?: string;
  onProgress?: (message: string) => void;
}

const PRODUCER = "MagicTech Quotation Designer";
/** Resolution every protected page is rendered at. */
export const PROTECTED_PDF_DPI = 200;
const DPI = PROTECTED_PDF_DPI;

/** One flattened page: JPEG bytes plus the page size in PDF points. */
export interface ProtectedPage {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stamp the watermark onto a rendered page and encode it as JPEG. `width` /
 * `height` are the page size in PDF points.
 */
export async function stampPage(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  watermark: WatermarkInfo,
  logo: ImageBitmap | null,
): Promise<ProtectedPage> {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not render the page");
  drawWatermark(ctx, canvas.width, canvas.height, watermark, logo);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.88),
  );
  if (!blob) throw new Error("Could not render the page");
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width, height };
}

/** Render every page of `bytes` with pdf.js, stamp the watermark, encode JPEG. */
async function renderWatermarkedPages(
  bytes: Uint8Array,
  watermark: WatermarkInfo,
  onProgress?: (message: string) => void,
): Promise<ProtectedPage[]> {
  // The legacy build carries polyfills for the very recent JS features the
  // modern build needs, so it also runs on browsers a few versions behind.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }
  const logo = await loadWatermarkLogo(watermark.logoUrl);
  // pdf.js takes ownership of (detaches) the buffer it is given — hand it a copy.
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const out: ProtectedPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress?.(`Preparing page ${n} of ${doc.numPages}…`);
      const page = await doc.getPage(n);
      // Page size in PDF points (1/72 in), rotation already applied.
      const size = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: DPI / 72 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport, background: "#ffffff" }).promise;
      out.push(
        await stampPage(canvas, size.width, size.height, watermark, logo).catch(() => {
          throw new Error(`Could not render page ${n}`);
        }),
      );
      page.cleanup();
      canvas.width = canvas.height = 0;
    }
    return out;
  } finally {
    logo?.close();
    await task.destroy();
  }
}

/** Returns the protected PDF bytes. Throws on an unreadable or already-locked input. */
export async function protectPdf(
  input: ArrayBuffer | Uint8Array,
  opts: ProtectPdfOptions,
): Promise<Uint8Array> {
  const { PDFDocument, EncryptedPDFError } = await import("@cantoo/pdf-lib");
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  // Validate first so a wrong file gets a clear message instead of a pdf.js error.
  try {
    await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    throw new Error(
      err instanceof EncryptedPDFError
        ? "This PDF is already password-protected. Use the original, unprotected PDF."
        : "That file doesn't look like a valid PDF.",
    );
  }

  const pages = await renderWatermarkedPages(bytes, opts.watermark, opts.onProgress);
  return buildProtectedPdf(pages, opts);
}

/**
 * Assemble already-stamped page images into the encrypted, print-only PDF
 * (steps 2 and 3 above).
 */
export async function buildProtectedPdf(
  pages: ProtectedPage[],
  opts: ProtectPdfOptions,
): Promise<Uint8Array> {
  const { PDFDocument } = await import("@cantoo/pdf-lib");
  const doc = await PDFDocument.create();
  for (const p of pages) {
    const img = await doc.embedJpg(p.jpeg);
    const page = doc.addPage([p.width, p.height]);
    page.drawImage(img, { x: 0, y: 0, width: p.width, height: p.height });
  }

  opts.onProgress?.("Encrypting (AES-256)…");
  const now = new Date();
  const recipient = opts.watermark.recipient?.trim();
  doc.setTitle(opts.title || "Quotation");
  doc.setAuthor("Magic Tech");
  if (recipient) doc.setSubject(`Issued to ${recipient}`);
  doc.setKeywords(["Magic Tech"]);
  doc.setCreator(PRODUCER);
  doc.setProducer(PRODUCER);
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  doc.encrypt({
    algorithm: "AES-256",
    ownerPassword: randomPassword(),
    userPassword: opts.openPassword || "",
    permissions: {
      printing: "highResolution",
      modifying: false,
      copying: false,
      annotating: false,
      fillingForms: false,
      contentAccessibility: false,
      documentAssembly: false,
    },
  });

  return doc.save();
}

/** A short, readable password (no look-alike characters) for the open password. */
export function generateOpenPassword(length = 10): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  // Reject the biased tail of each random byte so every character is equally likely.
  const limit = alphabet.length * Math.floor(256 / alphabet.length);
  let out = "";
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length))) {
      if (b < limit && out.length < length) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}
