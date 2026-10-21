/**
 * Watermark stamped on client-facing outputs: burned into every page of the
 * read-only PDF (lib/protectPdf) and printed as a header line on the Excel
 * export.
 *
 * The mark is small — one short diagonal stamp in the middle of the page: the
 * brand logo, and a line naming the recipient, the REF and the issue date, so
 * a copy that surfaces somewhere it shouldn't says whose copy it was.
 */

export interface WatermarkInfo {
  /** Client / company the document was issued to. */
  recipient?: string | null;
  /** Quotation REF. */
  reference?: string | null;
  /** Issue date as shown on the document. */
  date?: string | null;
  /** Brand logo drawn in place of the words "MAGIC TECH" (PDF stamp only). */
  logoUrl?: string | null;
}

export const WATERMARK_TITLE = "MAGIC TECH";

/** Long recipient names would run on; clip them with an ellipsis. */
function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** The two text lines of the mark. */
export function watermarkLines(info: WatermarkInfo): [string, string] {
  const parts = [
    info.recipient?.trim() ? `Issued to ${info.recipient.trim()}` : "",
    info.reference?.trim() || "",
    info.date?.trim() || "",
  ].filter(Boolean);
  return [
    WATERMARK_TITLE,
    clip(parts.length > 0 ? parts.join(" · ") : "Do not copy or distribute", 70),
  ];
}

/**
 * Fetch the brand logo for {@link drawWatermark}. Decoded from a fetched blob
 * (not an <img>) so a cross-origin logo can never taint the page canvas.
 * Null when it can't be loaded — the stamp then falls back to the words.
 */
export async function loadWatermarkLogo(
  url?: string | null,
): Promise<ImageBitmap | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

/**
 * Draw the mark onto a rendered page (`width` × `height` canvas pixels).
 * Sized relative to the page so it looks the same at any resolution.
 */
export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  info: WatermarkInfo,
  logo?: ImageBitmap | null,
): void {
  const [title, detail] = watermarkLines(info);
  const size = Math.round(width * 0.026);
  const titleY = -size * 0.45;
  let detailY = size * 0.65;
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(185, 28, 28, 0.18)";
  ctx.font = `700 ${size}px Arial, Helvetica, sans-serif`;
  if (logo) {
    // The logo stands in for the words "MAGIC TECH".
    const logoH = size * 2;
    const logoW = (logoH * logo.width) / logo.height;
    ctx.save();
    // Multiply keeps a logo's white background invisible over the page.
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.22;
    ctx.drawImage(logo, -logoW / 2, titleY - logoH / 2, logoW, logoH);
    ctx.restore();
    detailY = titleY + logoH / 2 + size * 0.7;
  } else {
    ctx.textAlign = "center";
    ctx.fillText(title, 0, titleY);
  }
  ctx.textAlign = "center";
  ctx.font = `600 ${Math.round(size * 0.55)}px Arial, Helvetica, sans-serif`;
  ctx.fillText(detail, 0, detailY);
  ctx.restore();
}
