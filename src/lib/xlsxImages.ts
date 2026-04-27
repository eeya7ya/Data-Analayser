/**
 * Extract embedded pictures from an .xlsx workbook on the client.
 *
 * The `xlsx` (SheetJS Community) library only returns cell text — drawing
 * objects, including pictures anchored to cells, are silently dropped. The
 * catalogue Excel files here use floating images anchored to a cell row
 * (column F, "pictures"), so to populate `products.picture_url` from the
 * spreadsheet we have to crack the .xlsx open ourselves and pull the
 * media out.
 *
 * .xlsx is a ZIP. The bits we need are:
 *   xl/worksheets/_rels/sheet1.xml.rels     → drawing reference
 *   xl/drawings/drawing1.xml                → row anchor for each picture
 *   xl/drawings/_rels/drawing1.xml.rels     → image filename for each rId
 *   xl/media/image*.{png,jpg,jpeg,…}        → actual image bytes
 *
 * The result is keyed by the zero-based row index in the worksheet, which
 * matches `XLSX.utils.sheet_to_json` data rows once you account for the
 * header row at index 0.
 */

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Minimal ZIP reader using the browser-native DecompressionStream.
 * Supports the only two compression methods .xlsx ever uses (stored = 0,
 * deflate = 8) and skips Zip64 / encryption — features Excel never
 * produces for normal workbooks.
 */
async function unzip(buffer: ArrayBuffer): Promise<ZipEntry[]> {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  // The End-of-Central-Directory record sits at the tail. It can be up to
  // 22 + 65535 bytes from the end if there's a comment; scan backward.
  let eocd = -1;
  const scanFrom = Math.max(0, buffer.byteLength - 65557);
  for (let i = buffer.byteLength - 22; i >= scanFrom; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP file (no EOCD)");

  const totalEntries = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);

  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];
  let p = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) {
      throw new Error("Bad central-directory entry");
    }
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = decoder.decode(u8.subarray(p + 46, p + 46 + nameLen));

    // Local header — its name/extra lengths can differ from the CD copy,
    // so re-read them before computing the data offset.
    const localNameLen = view.getUint16(localOff + 26, true);
    const localExtraLen = view.getUint16(localOff + 28, true);
    const dataOff = localOff + 30 + localNameLen + localExtraLen;
    const compressed = u8.subarray(dataOff, dataOff + compressedSize);

    let data: Uint8Array;
    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      const ds = new DecompressionStream("deflate-raw");
      const stream = new Blob([compressed]).stream().pipeThrough(ds);
      const buf = await new Response(stream).arrayBuffer();
      data = new Uint8Array(buf);
    } else {
      throw new Error(`Unsupported zip method ${method} for ${name}`);
    }

    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = "";
  // chunk the conversion to avoid blowing the call stack on large images
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

function attr(xml: string, tag: string, name: string): string | null {
  // crude but sufficient for the tiny rels XML files Excel writes — they
  // always use the same attribute order and never embed quote chars in
  // these particular attribute values.
  const re = new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`, "i");
  const m = re.exec(xml);
  return m ? m[1] : null;
}

interface RelEntry {
  id: string;
  target: string;
}

function parseRels(xml: string): RelEntry[] {
  const out: RelEntry[] = [];
  const re = /<Relationship\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[0];
    const id = /\bId="([^"]*)"/i.exec(tag)?.[1];
    const target = /\bTarget="([^"]*)"/i.exec(tag)?.[1];
    if (id && target) out.push({ id, target });
  }
  return out;
}

/**
 * Resolve a relative target like `../drawings/drawing1.xml` against the
 * rels file's base directory (e.g. `xl/worksheets/_rels`). Returns the
 * normalised, slash-joined path used as the ZIP entry name.
 */
function resolveTarget(baseDir: string, target: string): string {
  const parts = baseDir.split("/").filter(Boolean);
  // rels live in `<dir>/_rels/`, so step out of `_rels` first.
  if (parts[parts.length - 1] === "_rels") parts.pop();
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join("/");
}

/**
 * Pulls embedded pictures out of the first worksheet and returns a map
 * keyed by the zero-based row index they're anchored to. When several
 * pictures land on the same row the first one wins — the catalogue's
 * pictures column has at most one image per row, so this is fine in
 * practice.
 */
export async function extractWorksheetImages(
  buffer: ArrayBuffer,
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  let entries: ZipEntry[];
  try {
    entries = await unzip(buffer);
  } catch {
    // Not a zip / not an .xlsx — silently return empty so the caller
    // falls back to the plain text-only path.
    return result;
  }

  const byName = new Map<string, Uint8Array>();
  for (const e of entries) byName.set(e.name, e.data);

  const td = new TextDecoder("utf-8");
  const readText = (name: string): string | null => {
    const data = byName.get(name);
    return data ? td.decode(data) : null;
  };

  // Walk worksheet → drawing → media. Sticking to sheet1 matches the
  // CatalogueUpload caller, which only reads `wb.SheetNames[0]`.
  const sheetRels = readText("xl/worksheets/_rels/sheet1.xml.rels");
  if (!sheetRels) return result;

  const drawingRel = parseRels(sheetRels).find((r) =>
    r.target.toLowerCase().includes("drawing"),
  );
  if (!drawingRel) return result;

  const drawingPath = resolveTarget(
    "xl/worksheets/_rels",
    drawingRel.target,
  );
  const drawingXml = readText(drawingPath);
  if (!drawingXml) return result;

  const drawingDir = drawingPath.replace(/\/[^/]+$/, "");
  const drawingRelsPath = `${drawingDir}/_rels/${drawingPath
    .split("/")
    .pop()}.rels`;
  const drawingRelsXml = readText(drawingRelsPath);
  if (!drawingRelsXml) return result;

  const imageById = new Map<string, string>();
  for (const r of parseRels(drawingRelsXml)) {
    if (!/image/i.test(r.target)) continue;
    imageById.set(r.id, resolveTarget(`${drawingDir}/_rels`, r.target));
  }

  // Each anchor (oneCellAnchor / twoCellAnchor / absoluteAnchor) wraps a
  // picture element. We pull the row out of <xdr:from><xdr:row>N</xdr:row>
  // and the image rId out of <a:blip r:embed="rIdN"/>.
  const anchorRe = /<xdr:(?:one|two)CellAnchor\b[\s\S]*?<\/xdr:(?:one|two)CellAnchor>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(drawingXml)) !== null) {
    const block = m[0];
    const rowMatch = /<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/i.exec(block);
    if (!rowMatch) continue;
    const row = parseInt(rowMatch[1], 10);
    const embedId = attr(block, "a:blip", "r:embed") ||
      attr(block, "a:blip", "r:link");
    if (!embedId) continue;
    const imagePath = imageById.get(embedId);
    if (!imagePath) continue;
    const bytes = byName.get(imagePath);
    if (!bytes) continue;
    const ext = imagePath.split(".").pop()?.toLowerCase() || "";
    const mime = MIME_BY_EXT[ext] || "image/png";
    if (!result.has(row)) {
      result.set(row, bytesToDataUrl(bytes, mime));
    }
  }

  return result;
}
