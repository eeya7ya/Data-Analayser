/**
 * The read-only "PDF Full" of a quotation, built in the background (browser
 * only) — used by the sync folder, which can't open a print dialog for every
 * quotation the way the PDF Full button does.
 *
 *   1. A hidden frame loads the read-only viewer (`/quotation?id=…&view=1&bare=1`)
 *      — the same component PDF Full prints — at the printed page width.
 *   2. Its stylesheets are switched to paper: every `@media print` block is
 *      turned on and every `@media screen` block off, so the sheets lay out
 *      exactly as they do when printed.
 *   3. Each sheet is cut into A4 pages the way the print engine does it: the
 *      brand strip on top and the address footer at the bottom of every page,
 *      items rows never split, a system banner never left alone at the foot of
 *      a page, and the items table's column headings repeated on each
 *      continuation page. The cover and about-us artwork fill their own pages.
 *   4. The browser itself paints each page: the sheet, its ancestors and the
 *      page's (paper) CSS go into an SVG <foreignObject>, which is drawn at the
 *      PDF Full resolution — so text, fonts and borders come out exactly as
 *      Chrome prints them. lib/protectPdf then stamps the same watermark and
 *      applies the same AES-256 print-only lock (no open password).
 */

import {
  buildProtectedPdf,
  stampPage,
  PROTECTED_PDF_DPI,
  type ProtectedPage,
} from "@/lib/protectPdf";
import { loadWatermarkLogo, type WatermarkInfo } from "@/lib/watermark";
import { buildPrintTitle } from "@/lib/printFilename";

// Paper geometry — must match the `@page` rules in globals.css.
const PX_PER_MM = 96 / 25.4;
const PAGE_MM = { width: 210, height: 297 };
const MARGIN_MM = { top: 14, left: 12, right: 12, bottom: 18 };
const AREA_W_MM = PAGE_MM.width - MARGIN_MM.left - MARGIN_MM.right;
const AREA_H = (PAGE_MM.height - MARGIN_MM.top - MARGIN_MM.bottom) * PX_PER_MM;
const PT_PER_MM = 72 / 25.4;

/** Device pixels per CSS pixel at the PDF Full resolution. */
const SCALE = PROTECTED_PDF_DPI / 96;
const DEVICE_PER_MM = PROTECTED_PDF_DPI / 25.4;
const PAGE_PX = {
  width: Math.round(PAGE_MM.width * DEVICE_PER_MM),
  height: Math.round(PAGE_MM.height * DEVICE_PER_MM),
};

/** Layout rounding tolerance (CSS px). */
const EPS = 0.5;
/** An unknown media type: it never matches, so `screen` rules switch off. */
const OFF_MEDIA = "mt-paper-off";
const LOAD_TIMEOUT_MS = 45_000;

export interface QuotationPdf {
  bytes: Uint8Array;
  pages: number;
}

export interface QuotationPdfRenderer {
  /** The protected PDF of one quotation. One call at a time. */
  render(quotationId: number): Promise<QuotationPdf>;
  /** Remove the hidden frame and free cached images. */
  dispose(): void;
}

export function createQuotationPdfRenderer(): QuotationPdfRenderer {
  let frame: HTMLIFrameElement | null = null;
  const images = new Map<string, Promise<ImageBitmap | null>>();
  const image = (url: string | null | undefined) => {
    if (!url) return Promise.resolve(null);
    if (!images.has(url)) images.set(url, loadWatermarkLogo(url));
    return images.get(url)!;
  };
  const dataUrls = new Map<string, Promise<string | null>>();
  const dataUrl = (url: string) => {
    if (!dataUrls.has(url)) dataUrls.set(url, toDataUrl(url));
    return dataUrls.get(url)!;
  };

  return {
    async render(quotationId) {
      frame ??= createFrame();
      const { doc, watermark, title } = await loadQuotation(frame, quotationId);
      emulatePrint(doc);
      await settle();
      const css = pageCss(doc);

      const logo = await image(watermark.logoUrl);
      const sheets = printedSheets(doc);
      // The painted copy is XML, which can't carry these: drop them from the
      // page too, so the layout measured here is the layout painted.
      for (const sheet of sheets) stripNonXml(sheet);
      const pages: ProtectedPage[] = [];
      for (const sheet of sheets) {
        if (sheet.classList.contains("full-bleed")) {
          const src = sheet.querySelector("img");
          const art = await image(src ? src.currentSrc || src.src : null);
          if (!art) throw new Error("the cover artwork couldn't be loaded");
          const canvas = blankPage();
          drawCover(canvas, art);
          pages.push(await stamp(canvas, watermark, logo));
          continue;
        }
        const copy = await copySheet(sheet, css, dataUrl);
        for (const canvas of await paintSheet(sheet, copy, planSheet(sheet))) {
          pages.push(await stamp(canvas, watermark, logo));
        }
      }
      if (pages.length === 0) throw new Error("the quotation has no printable pages");
      const bytes = await buildProtectedPdf(pages, { watermark, title });
      return { bytes, pages: pages.length };
    },
    dispose() {
      frame?.remove();
      frame = null;
      for (const p of images.values()) void p.then((b) => b?.close());
      images.clear();
      dataUrls.clear();
    },
  };
}

// ── Loading the viewer ─────────────────────────────────────────────────────

function createFrame(): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  // As wide as the printed page area; taller than wide so orientation
  // queries see portrait, as they do on A4.
  frame.style.cssText =
    `position:fixed;left:-10000px;top:0;width:${AREA_W_MM}mm;height:1200px;` +
    "border:0;pointer-events:none;";
  document.body.appendChild(frame);
  return frame;
}

async function loadQuotation(
  frame: HTMLIFrameElement,
  quotationId: number,
): Promise<{ doc: Document; watermark: WatermarkInfo; title: string }> {
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      frame.onload = null;
      reject(new Error("the quotation page took too long to load"));
    }, LOAD_TIMEOUT_MS);
    frame.onload = () => {
      window.clearTimeout(timer);
      frame.onload = null;
      resolve();
    };
    frame.src = `/quotation?id=${quotationId}&view=1&bare=1`;
  });
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!win || !doc) throw new Error("the quotation page couldn't be opened");
  if (win.location.pathname.startsWith("/login")) {
    throw new Error("signed out — sign in again and re-run the sync");
  }

  // The viewer fetches the quotation after the page loads.
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  let root: HTMLElement | null = null;
  while (Date.now() < deadline) {
    const failed = doc.querySelector("[data-quotation-load-error]");
    if (failed) {
      throw new Error(failed.getAttribute("data-quotation-load-error") || "the quotation didn't load");
    }
    root = doc.querySelector<HTMLElement>("[data-pdf-watermark]");
    if (root && doc.querySelector(".quotation-sheet")) break;
    root = null;
    await sleep(150);
  }
  if (!root) throw new Error("the quotation didn't load");

  // Off-screen images must load before the layout is measured.
  for (const img of Array.from(doc.images)) img.loading = "eager";
  await imagesSettled(doc, deadline);
  try {
    await doc.fonts.ready;
  } catch {
    /* no font loading API */
  }

  let watermark: WatermarkInfo = {};
  try {
    watermark = JSON.parse(root.getAttribute("data-pdf-watermark") || "{}") as WatermarkInfo;
  } catch {
    /* unstamped details — the mark falls back to its generic line */
  }
  return {
    doc,
    watermark,
    title: root.getAttribute("data-pdf-title") || buildPrintTitle(watermark.reference ?? null, null),
  };
}

/** Wait until every image has finished (a broken logo swaps its src once). */
async function imagesSettled(doc: Document, deadline: number): Promise<void> {
  let stableSince = 0;
  while (Date.now() < deadline) {
    const pending = Array.from(doc.images).some((img) => !img.complete);
    if (!pending) {
      if (stableSince === 0) stableSince = Date.now();
      if (Date.now() - stableSince >= 300) return;
    } else {
      stableSince = 0;
    }
    await sleep(100);
  }
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
/** Let style and layout catch up after the media switch. */
const settle = () => sleep(120);

// ── Print emulation ────────────────────────────────────────────────────────

/** Turn every `@media print` rule on and every `@media screen` rule off. */
function emulatePrint(doc: Document): void {
  for (const sheet of Array.from(doc.styleSheets)) {
    switchMedia(sheet.media);
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a cross-origin sheet carries none of our print rules
    }
    switchRules(rules);
  }
  if (!doc.getElementById("mt-paper")) {
    const style = doc.createElement("style");
    style.id = "mt-paper";
    // Paper has no scrollbar; on screen one would narrow the page.
    style.textContent = "html{scrollbar-width:none}html::-webkit-scrollbar{display:none}";
    doc.head.appendChild(style);
  }
}

function switchRules(rules: CSSRuleList): void {
  for (const rule of Array.from(rules)) {
    switchMedia((rule as CSSMediaRule).media);
    const inner = (rule as CSSGroupingRule).cssRules;
    if (inner) switchRules(inner);
  }
}

function switchMedia(media: MediaList | undefined): void {
  if (!media || typeof media.mediaText !== "string" || !media.mediaText) return;
  const text = media.mediaText;
  const next = text.replace(/\bprint\b/gi, "all").replace(/\bscreen\b/gi, OFF_MEDIA);
  if (next !== text) media.mediaText = next;
}

/** The sheets that print, in order (a hidden one — e.g. a draft cover — doesn't). */
function printedSheets(doc: Document): HTMLElement[] {
  const win = doc.defaultView!;
  return Array.from(doc.querySelectorAll<HTMLElement>(".quotation-sheet")).filter(
    (s) => win.getComputedStyle(s).display !== "none" && !s.parentElement?.closest(".quotation-sheet"),
  );
}

// ── Pagination ─────────────────────────────────────────────────────────────

/** A vertical band of a sheet, in CSS px from the sheet's top edge. */
interface Band {
  top: number;
  bottom: number;
}

interface PagePlan {
  /** Body content of the page. */
  body: Band;
  /** Column headings repeated above `body` on a continuation page. */
  repeat: Band[];
  /** Where the footer goes, in CSS px from the top of the page area. */
  footY: number;
}

interface SheetPlan {
  width: number;
  height: number;
  head: Band | null;
  foot: Band | null;
  pages: PagePlan[];
}

/** Something a page break must not cut through. */
interface Box {
  top: number;
  bottom: number;
  /** Must stay on the same page as what follows it (break-after: avoid). */
  keep: boolean;
}

interface TableInfo {
  top: number;
  bottom: number;
  head: Band;
}

const MONOLITHIC = new Set(["TR", "TD", "TH", "IMG", "SVG", "CANVAS", "VIDEO", "INPUT", "TEXTAREA", "SELECT", "BUTTON"]);

function planSheet(sheet: HTMLElement): SheetPlan {
  const win = sheet.ownerDocument.defaultView!;
  const rect = sheet.getBoundingClientRect();
  const origin = rect.top;
  const band = (el: Element): Band => {
    const r = el.getBoundingClientRect();
    return { top: r.top - origin, bottom: r.bottom - origin };
  };
  const width = rect.width;
  const height = rect.height;

  const layout = sheet.querySelector(":scope > table.sheet-layout");
  const cell = layout?.querySelector<HTMLElement>(":scope > tbody > tr > td");
  if (!layout || !cell) {
    // Not a page-frame sheet: cut it at page height.
    const pages: PagePlan[] = [];
    for (let y = 0; y < height - EPS; y += AREA_H) {
      pages.push({ body: { top: y, bottom: Math.min(height, y + AREA_H) }, repeat: [], footY: AREA_H });
    }
    return { width, height, head: null, foot: null, pages };
  }

  const theadEl = layout.querySelector(":scope > thead");
  const tfootEl = layout.querySelector(":scope > tfoot");
  const head = theadEl ? band(theadEl) : null;
  const foot = tfootEl ? band(tfootEl) : null;
  const headH = head ? head.bottom - head.top : 0;
  const footH = foot ? foot.bottom - foot.top : 0;

  const bodyTop = band(cell).top;
  let bodyEnd = bodyTop;
  for (const child of Array.from(cell.children)) {
    if (win.getComputedStyle(child).display === "none") continue;
    bodyEnd = Math.max(bodyEnd, band(child).bottom);
  }

  const boxes: Box[] = [];
  collectBoxes(cell, origin, boxes, false, true);
  const tables = collectTables(cell, origin);
  const bottomsDesc = [...new Set(boxes.map((b) => b.bottom))].sort((a, b) => b - a);

  const pages: PagePlan[] = [];
  let start = bodyTop;
  let repeat: Band[] = [];
  for (;;) {
    const repeatH = repeat.reduce((h, b) => h + (b.bottom - b.top), 0);
    const avail = AREA_H - headH - footH - repeatH;
    // (A header + footer leaving no room can't be paged; keep it one page.)
    if (bodyEnd - start <= avail + EPS || avail < 1 || pages.length > 400) {
      pages.push({ body: { top: start, bottom: bodyEnd }, repeat, footY: AREA_H - footH });
      break;
    }
    const cut = chooseCut(boxes, bottomsDesc, start, start + avail);
    const inTable = tables.some((t) => t.top < cut - EPS && cut < t.bottom - EPS);
    // A collapsed border straddles the cut: keep all of it on this page.
    pages.push({ body: { top: start, bottom: inTable ? cut + 1 : cut }, repeat, footY: AREA_H - footH });
    repeat = tables
      .filter((t) => t.head.bottom <= cut + EPS && cut < t.bottom - EPS)
      .map((t) => t.head);
    start = nextStart(boxes, cut);
  }

  // A one-page sheet keeps the footer where the layout puts it (the body
  // cell's height floor lands it at the foot of the page); a sheet that runs
  // on has it at the foot of every page, as the print engine reserves it.
  if (pages.length === 1 && foot) pages[0].footY = Math.min(foot.top, AREA_H - footH);
  return { width, height, head, foot, pages };
}

/**
 * Gather the boxes inside `el` (and `el` itself unless it's the `root` — the
 * page body cell, which is a table cell but of course spans pages).
 */
function collectBoxes(
  el: Element,
  origin: number,
  out: Box[],
  insideMonolith: boolean,
  root = false,
): void {
  const win = el.ownerDocument.defaultView!;
  const style = win.getComputedStyle(el);
  if (style.display === "none") return;
  const tag = el.tagName.toUpperCase();
  const monolith =
    !root &&
    (MONOLITHIC.has(tag) ||
      style.breakInside.startsWith("avoid") ||
      style.display.startsWith("inline-"));
  const keep =
    !root &&
    (style.breakAfter.startsWith("avoid") ||
      (tag === "TR" && el.parentElement?.tagName.toUpperCase() === "THEAD"));
  if (monolith || keep) {
    const r = el.getBoundingClientRect();
    if (r.height > 0) out.push({ top: r.top - origin, bottom: r.bottom - origin, keep });
  }
  const inner = insideMonolith || monolith;
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      collectBoxes(child as Element, origin, out, inner);
    } else if (!inner && child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
      // Free-flowing text may break between its lines.
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(child);
      for (const r of Array.from(range.getClientRects())) {
        if (r.height > 0 && r.width > 0) out.push({ top: r.top - origin, bottom: r.bottom - origin, keep: false });
      }
      range.detach();
    }
  }
}

function collectTables(cell: Element, origin: number): TableInfo[] {
  const win = cell.ownerDocument.defaultView!;
  const out: TableInfo[] = [];
  for (const table of Array.from(cell.querySelectorAll("table"))) {
    const thead = table.querySelector(":scope > thead");
    if (!thead || win.getComputedStyle(thead).display !== "table-header-group") continue;
    const t = table.getBoundingClientRect();
    const h = thead.getBoundingClientRect();
    if (h.height <= 0) continue;
    out.push({
      top: t.top - origin,
      bottom: t.bottom - origin,
      head: { top: h.top - origin, bottom: h.bottom - origin },
    });
  }
  return out.sort((a, b) => a.top - b.top);
}

/** The lowest break at or above `limit` that cuts no row, line or kept block. */
function chooseCut(boxes: Box[], bottomsDesc: number[], start: number, limit: number): number {
  for (const y of bottomsDesc) {
    if (y > limit + EPS) continue;
    if (y <= start + 1) break;
    if (canBreakAt(boxes, y)) return y;
  }
  // Nothing fits (one block taller than a page): cut it, as print does.
  return limit;
}

function canBreakAt(boxes: Box[], y: number): boolean {
  let lastBottom = -Infinity;
  let keep = false;
  for (const b of boxes) {
    if (b.top < y - EPS && b.bottom > y + EPS) return false;
    if (b.bottom <= y + EPS) {
      if (b.bottom > lastBottom + EPS) {
        lastBottom = b.bottom;
        keep = b.keep;
      } else if (b.bottom >= lastBottom - EPS) {
        keep ||= b.keep;
      }
    }
  }
  // The content right above the break may not be glued to what follows.
  return !keep;
}

/** Where the next page's content starts: a margin at a break is dropped. */
function nextStart(boxes: Box[], cut: number): number {
  let next = Infinity;
  for (const b of boxes) {
    if (b.top >= cut - EPS && b.top < next) next = b.top;
    if (b.top < cut - EPS && b.bottom > cut + EPS) return cut; // a forced cut
  }
  return Number.isFinite(next) && next > cut ? next : cut;
}

// ── Painting ───────────────────────────────────────────────────────────────

function blankPage(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_PX.width;
  canvas.height = PAGE_PX.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Full-bleed artwork, `object-fit: cover` on the whole sheet. */
function drawCover(canvas: HTMLCanvasElement, art: ImageBitmap): void {
  const ctx = canvas.getContext("2d")!;
  const scale = Math.max(canvas.width / art.width, canvas.height / art.height);
  const w = art.width * scale;
  const h = art.height * scale;
  ctx.drawImage(art, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

/** Every rule of the page's stylesheets (already switched to paper). */
function pageCss(doc: Document): string {
  let css = "";
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const media = sheet.media?.mediaText;
    let text = "";
    for (const rule of Array.from(rules)) text += `${rule.cssText}\n`;
    css += media && media !== "all" ? `@media ${media}{${text}}\n` : text;
  }
  return css;
}

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const XHTML = "http://www.w3.org/1999/xhtml";

/**
 * A sheet ready to be painted through an SVG <foreignObject>: a copy of it
 * inside bare copies of its ancestors (so every selector and inherited value
 * resolves as on the page), the page CSS alongside, images inlined (an SVG
 * image loads nothing from outside). The sheet lands at the top-left corner.
 */
interface SheetCopy {
  root: Element;
  /** Each image with its band and a same-size blank, so a band only carries its own pictures. */
  images: Array<{ el: Element; top: number; bottom: number; src: string; blank: string }>;
}

async function copySheet(
  sheet: HTMLElement,
  css: string,
  dataUrl: (url: string) => Promise<string | null>,
): Promise<SheetCopy> {
  const origin = sheet.getBoundingClientRect().top;
  const clone = sheet.cloneNode(true) as HTMLElement;

  const from = Array.from(sheet.querySelectorAll("img"));
  const to = Array.from(clone.querySelectorAll("img"));
  const images: SheetCopy["images"] = [];
  await Promise.all(
    from.map(async (img, i) => {
      const target = to[i];
      if (!target) return;
      target.removeAttribute("srcset");
      target.removeAttribute("sizes");
      target.removeAttribute("loading");
      const raw = img.currentSrc || img.src;
      const src = raw && !raw.startsWith("data:") ? (await dataUrl(raw)) ?? raw : raw;
      target.setAttribute("src", src);
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        const r = img.getBoundingClientRect();
        images.push({
          el: target,
          top: r.top - origin,
          bottom: r.bottom - origin,
          src,
          // Same intrinsic size, so the layout doesn't move.
          blank:
            "data:image/svg+xml," +
            encodeURIComponent(
              `<svg xmlns="http://www.w3.org/2000/svg" width="${img.naturalWidth}" height="${img.naturalHeight}"/>`,
            ),
        });
      }
    }),
  );
  // Live values of form controls aren't attributes; make them so.
  const win = sheet.ownerDocument.defaultView!;
  const liveFrom = Array.from(sheet.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"));
  const liveTo = Array.from(clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"));
  liveFrom.forEach((el, i) => {
    const target = liveTo[i];
    if (!target) return;
    if (el instanceof win.HTMLTextAreaElement) target.textContent = el.value;
    else target.setAttribute("value", el.value);
  });

  let node: Element = clone;
  const parent = sheet.parentElement;
  for (let a: Element | null = parent; a; a = a.parentElement) {
    const shell = a.cloneNode(false) as HTMLElement;
    // Only what's on the way down to the sheet: no offsets around it.
    shell.style.setProperty("margin", "0", "important");
    shell.style.setProperty("padding", "0", "important");
    shell.style.setProperty("border", "0", "important");
    shell.appendChild(node);
    // `.quotation-sheet:last-child` styles the final sheet differently.
    if (a === parent && parent.lastElementChild !== sheet) {
      shell.appendChild(a.ownerDocument.createElementNS(XHTML, "div"));
    }
    node = shell;
  }
  const style = node.ownerDocument.createElementNS(XHTML, "style");
  style.textContent = css;
  node.insertBefore(style, node.firstChild);
  return { root: node, images };
}

/** Characters XML 1.0 forbids (a pasted control character would void the SVG). */
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function stripNonXml(root: Element): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    NOT_XML.lastIndex = 0;
    if (NOT_XML.test(text.data)) text.data = text.data.replace(NOT_XML, "");
  }
}

/** Paint `band` of the sheet (CSS px from its top) as a canvas at the PDF resolution. */
async function paintBand(
  copy: SheetCopy,
  width: number,
  height: number,
  band: Band,
): Promise<HTMLCanvasElement | null> {
  const h = band.bottom - band.top;
  if (h <= 0) return null;
  for (const im of copy.images) {
    im.el.setAttribute("src", im.bottom >= band.top && im.top <= band.bottom ? im.src : im.blank);
  }
  const markup = new XMLSerializer().serializeToString(copy.root).replace(NOT_XML, "");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" ` +
    `viewBox="0 ${band.top} ${width} ${h}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${Math.ceil(height) + 1}">${markup}</foreignObject></svg>`;
  // A data: URL — the browser keeps a canvas it draws one onto readable
  // (a blob: URL would taint it).
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await img.decode();
  } catch {
    throw new Error("a page couldn't be drawn");
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * SCALE);
  canvas.height = Math.max(1, Math.round(h * SCALE));
  // Drawn at device size, so the browser rasterises it at the PDF resolution.
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function paintSheet(
  sheet: HTMLElement,
  copy: SheetCopy,
  plan: SheetPlan,
): Promise<HTMLCanvasElement[]> {
  // Lay the copy out at the frame's width, as the sheet itself is.
  const width = sheet.ownerDocument.documentElement.clientWidth;
  const left = MARGIN_MM.left * DEVICE_PER_MM;
  const top = MARGIN_MM.top * DEVICE_PER_MM;
  // The brand strip, footer and column headings repeat: paint each once.
  const repeated = new Map<string, Promise<HTMLCanvasElement | null>>();
  const once = (band: Band) => {
    const key = `${band.top}|${band.bottom}`;
    if (!repeated.has(key)) repeated.set(key, paintBand(copy, width, plan.height, band));
    return repeated.get(key)!;
  };
  const put = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement | null, atY: number) => {
    if (canvas) ctx.drawImage(canvas, left, top + atY * SCALE);
  };

  const out: HTMLCanvasElement[] = [];
  try {
    for (const page of plan.pages) {
      const canvas = blankPage();
      const ctx = canvas.getContext("2d")!;
      let y = 0;
      if (plan.head) {
        put(ctx, await once(plan.head), 0);
        y = plan.head.bottom - plan.head.top;
      }
      for (const r of page.repeat) {
        put(ctx, await once(r), y);
        y += r.bottom - r.top;
      }
      const body = await paintBand(copy, width, plan.height, page.body);
      put(ctx, body, y);
      if (body) body.width = body.height = 0;
      if (plan.foot) put(ctx, await once(plan.foot), page.footY);
      out.push(canvas);
    }
  } finally {
    for (const p of repeated.values()) void p.then((c) => c && (c.width = c.height = 0));
  }
  return out;
}

async function stamp(
  canvas: HTMLCanvasElement,
  watermark: WatermarkInfo,
  logo: ImageBitmap | null,
): Promise<ProtectedPage> {
  try {
    return await stampPage(canvas, PAGE_MM.width * PT_PER_MM, PAGE_MM.height * PT_PER_MM, watermark, logo);
  } finally {
    canvas.width = canvas.height = 0;
  }
}
