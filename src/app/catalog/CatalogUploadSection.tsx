"use client";

import { useCallback, useState } from "react";
import CatalogueUpload from "@/components/CatalogueUpload";
import {
  Download,
  Upload,
  FileSpreadsheet,
  Camera,
  Loader2,
  Info,
  AlertCircle,
  ChevronDown,
} from "@/lib/icons";

/**
 * Admin catalogue management strip. Bundles the two offline workflows
 * together so the round-trip "download, edit in Excel, upload back" is a
 * single click each way:
 *
 *   Export current catalogue  → downloads products.xlsx with the exact
 *                               column layout the uploader expects.
 *   Upload Excel catalogue    → opens the existing bulk upsert form.
 *
 * For surgical one-row edits, `CatalogBrowser` now also exposes an inline
 * edit mode, so the Excel round-trip is reserved for bulk changes.
 *
 * The "include pictures" checkbox controls whether the export embeds the
 * product images directly into the .xlsx (so the admin can edit pictures
 * outside the database and re-import) or skips them for a small,
 * text-only workbook suitable for bulk price edits.
 */
export default function CatalogUploadSection() {
  const [show, setShow] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [includePictures, setIncludePictures] = useState(true);

  const exportCatalogue = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    setExportStatus("Fetching catalogue…");
    try {
      const res = await fetch("/api/catalogue/export");
      const data = (await res.json()) as {
        products?: Array<Record<string, unknown>>;
        error?: string;
      };
      if (!res.ok) {
        setExportError(data.error || `Export failed (HTTP ${res.status})`);
        return;
      }
      const rows = Array.isArray(data.products) ? data.products : [];
      if (rows.length === 0) {
        setExportError("Nothing to export — the catalogue is empty.");
        return;
      }

      // Lazy-load whichever writer we need so the page stays light for
      // read-only viewers. `xlsx` is small and writes text-only workbooks
      // very fast; `exceljs` is heavier (~400 KB gz) but supports
      // embedding pictures directly into anchored cells, which the
      // existing /lib/xlsxImages reader picks up on re-import.
      if (!includePictures) {
        await exportTextOnly(rows);
      } else {
        setExportStatus("Embedding pictures…");
        await exportWithPictures(rows, (msg) => setExportStatus(msg));
      }
    } catch (err) {
      setExportError((err as Error).message || "Export failed");
    } finally {
      setExporting(false);
      setExportStatus(null);
    }
  }, [includePictures]);

  return (
    <section className="mb-5 rounded-2xl border border-magic-border bg-white p-5 shadow-mt-soft">
      <div className="mb-4 flex items-center gap-2">
        <FileSpreadsheet className="h-4 w-4 text-magic-red" />
        <h2 className="text-sm font-bold text-magic-ink">Bulk Excel tools</h2>
        <span className="text-[11px] text-magic-ink/45">
          for changing many products at once
        </span>
      </div>

      {/* Two halves of one round-trip: export → edit in Excel → upload back. */}
      <div className="grid gap-3 md:grid-cols-2">
        {/* ── Export ── */}
        <div className="flex flex-col rounded-xl border border-magic-border bg-magic-soft/40 p-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-magic-ink/70 shadow-sm">
              <Download className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-magic-ink">
                Export catalogue
              </p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-magic-ink/55">
                Download every product as .xlsx, ready to edit.
              </p>
            </div>
          </div>

          {/* Picture toggle — a real switch, not a bare native checkbox. */}
          <button
            type="button"
            role="switch"
            aria-checked={includePictures}
            disabled={exporting}
            onClick={() => setIncludePictures((v) => !v)}
            className="mt-3 flex w-full items-center gap-2.5 rounded-lg border border-magic-border bg-white px-3 py-2 text-left transition-colors hover:border-magic-red/40 disabled:opacity-50"
          >
            <span
              className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
                includePictures ? "bg-magic-red" : "bg-magic-ink/20"
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                  includePictures ? "translate-x-3.5" : "translate-x-0.5"
                }`}
              />
            </span>
            <Camera className="h-3.5 w-3.5 shrink-0 text-magic-ink/45" />
            <span className="text-[11.5px] font-medium text-magic-ink/75">
              Embed pictures into the workbook
            </span>
          </button>

          <button
            onClick={exportCatalogue}
            disabled={exporting}
            title="Download the current catalogue as an Excel file. Edit it and re-upload to apply your changes."
            className="mt-2.5 inline-flex items-center justify-center gap-2 rounded-lg bg-magic-ink px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-magic-ink/85 disabled:opacity-60"
          >
            {exporting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {exportStatus ?? "Preparing…"}
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                Export as Excel
              </>
            )}
          </button>
        </div>

        {/* ── Upload ── */}
        <div className="flex flex-col rounded-xl border border-magic-border bg-magic-soft/40 p-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-magic-ink/70 shadow-sm">
              <Upload className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-magic-ink">
                Upload Excel catalogue
              </p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-magic-ink/55">
                Push an edited workbook back into the live catalogue.
              </p>
            </div>
          </div>

          <button
            onClick={() => setShow((v) => !v)}
            aria-expanded={show}
            className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg border border-magic-border bg-white px-4 py-2.5 text-[13px] font-semibold text-magic-ink shadow-sm transition-colors hover:border-magic-red/40 hover:text-magic-red"
          >
            {show ? (
              <>
                <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                Hide upload
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5" />
                Choose a file
              </>
            )}
          </button>
        </div>
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-magic-ink/50">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" />
        <span>
          Exported rows are matched by <b className="font-semibold">model</b> on
          re-import — edit values (and pictures, when embedded) in Excel, then
          upload the file again to update the catalogue.
        </span>
      </p>

      {exportError && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] font-medium text-red-700">
          <AlertCircle className="mt-px h-4 w-4 shrink-0" />
          {exportError}
        </div>
      )}

      {show && (
        <div className="mt-4 border-t border-magic-border pt-4">
          <CatalogueUpload
            onDone={() => {
              setShow(false);
              window.location.reload();
            }}
          />
        </div>
      )}
    </section>
  );
}

/**
 * Text-only export: the historical 10-column workbook with no pictures.
 * Kept as a fast path for admins doing bulk price edits — opens
 * instantly in Excel and stays small even on the full 2000+ row catalogue.
 */
async function exportTextOnly(
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const XLSX = await import("xlsx");
  const header = [
    "vendor",
    "system",
    "category",
    "sub_category",
    "fast_view",
    "model",
    "description",
    "currency",
    "price_si",
    "specifications",
  ];
  const aoa: unknown[][] = [header];
  for (const row of rows) {
    aoa.push([
      row.vendor ?? "",
      row.system ?? "",
      row.category ?? "",
      row.sub_category ?? "",
      row.fast_view ?? "",
      row.model ?? "",
      row.description ?? "",
      row.currency ?? "USD",
      Number(row.price_si ?? 0),
      row.specifications ?? "",
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 22 },
    { wch: 24 },
    { wch: 48 },
    { wch: 10 },
    { wch: 12 },
    { wch: 40 },
  ];
  for (let i = 1; i < aoa.length; i++) {
    const addr = XLSX.utils.encode_cell({ r: i, c: 8 });
    const cell = ws[addr];
    if (cell && typeof cell.v === "number") {
      cell.z = "#,##0.00";
      cell.t = "n";
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Catalogue");
  XLSX.writeFile(wb, downloadName());
}

/**
 * Embedded-pictures export. Builds the workbook with ExcelJS so each
 * row's image can be anchored to a `picture` column on the same row.
 *
 * Pictures from `picture_url`:
 *   - `data:image/...;base64,...` → decoded directly and embedded.
 *   - `http(s)://...`             → fetched client-side. CORS may
 *                                    refuse, in which case we skip
 *                                    the image and continue (the row
 *                                    still exports with text columns).
 *
 * On re-import, /lib/xlsxImages walks the same drawing anchors and
 * pulls each image back into `picture_url` as a fresh data URL.
 * Round-trip is lossless for the pictures the admin doesn't edit and
 * captures whatever they replaced for the ones they did.
 */
async function exportWithPictures(
  rows: Array<Record<string, unknown>>,
  onProgress: (msg: string) => void,
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MagicTech Catalogue Export";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Catalogue");

  sheet.columns = [
    { header: "vendor", key: "vendor", width: 14 },
    { header: "system", key: "system", width: 18 },
    { header: "category", key: "category", width: 18 },
    { header: "sub_category", key: "sub_category", width: 18 },
    { header: "fast_view", key: "fast_view", width: 22 },
    { header: "model", key: "model", width: 24 },
    { header: "description", key: "description", width: 48 },
    { header: "currency", key: "currency", width: 10 },
    { header: "price_si", key: "price_si", width: 12, style: { numFmt: "#,##0.00" } },
    { header: "specifications", key: "specifications", width: 40 },
    { header: "picture", key: "picture", width: 18 },
  ];
  sheet.getRow(1).font = { bold: true };

  const PICTURE_COL = 10; // 0-based ExcelJS column index for "picture"

  // Push rows first so the cell range is laid out, then anchor images
  // on top of the picture column. ExcelJS bumps row heights for us
  // once we set them per-row.
  for (const row of rows) {
    sheet.addRow({
      vendor: row.vendor ?? "",
      system: row.system ?? "",
      category: row.category ?? "",
      sub_category: row.sub_category ?? "",
      fast_view: row.fast_view ?? "",
      model: row.model ?? "",
      description: row.description ?? "",
      currency: row.currency ?? "USD",
      price_si: Number(row.price_si ?? 0),
      specifications: row.specifications ?? "",
      picture: "",
    });
  }

  const PICTURE_ROW_HEIGHT = 64; // points, ≈ 85 px tall for the image
  let embedded = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const url = String(rows[i].picture_url ?? "").trim();
    if (!url) continue;

    let bytes: Uint8Array | null = null;
    let mime: "png" | "jpeg" | "gif" = "png";
    try {
      if (url.startsWith("data:")) {
        const parsed = decodeDataUrl(url);
        if (parsed) {
          bytes = parsed.bytes;
          mime = parsed.mime;
        }
      } else if (url.startsWith("http://") || url.startsWith("https://")) {
        const fetched = await fetch(url).catch(() => null);
        if (fetched && fetched.ok) {
          const buf = await fetched.arrayBuffer();
          bytes = new Uint8Array(buf);
          const ct = fetched.headers.get("content-type") ?? "";
          mime = ct.includes("jpeg") || ct.includes("jpg")
            ? "jpeg"
            : ct.includes("gif")
              ? "gif"
              : "png";
        }
      }
    } catch {
      bytes = null;
    }

    if (!bytes) {
      skipped += 1;
      continue;
    }

    // Convert Uint8Array → ArrayBuffer view that ExcelJS accepts.
    const view = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? (bytes.buffer as ArrayBuffer)
      : (bytes.slice().buffer as ArrayBuffer);

    const imageId = workbook.addImage({
      buffer: view,
      extension: mime,
    });

    // Row index in ExcelJS is 1-based and the data starts at row 2
    // (row 1 is the header). Image anchor uses 0-based coordinates.
    const rowIdx0 = i + 1; // 0-based row inside drawing.xml = header + data offset
    sheet.getRow(i + 2).height = PICTURE_ROW_HEIGHT;
    sheet.addImage(imageId, {
      tl: { col: PICTURE_COL, row: rowIdx0 },
      ext: { width: 100, height: 80 },
      editAs: "oneCell",
    });
    embedded += 1;

    // Lightweight progress nudge every 50 images so the spinner text
    // moves and the admin knows the export is making progress on a
    // large catalogue.
    if (embedded % 50 === 0) {
      onProgress(`Embedding pictures… ${embedded} of ${rows.length}`);
      // Yield to the event loop so the UI can re-paint.
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress(
    `Writing workbook (${embedded} embedded${skipped ? `, ${skipped} skipped` : ""})…`,
  );

  const buf = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, downloadName());
}

function decodeDataUrl(
  url: string,
): { bytes: Uint8Array; mime: "png" | "jpeg" | "gif" } | null {
  const m = url.match(/^data:image\/(png|jpe?g|gif);base64,(.+)$/i);
  if (!m) return null;
  const mimeRaw = m[1].toLowerCase();
  const mime: "png" | "jpeg" | "gif" =
    mimeRaw === "gif" ? "gif" : mimeRaw === "png" ? "png" : "jpeg";
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime };
  } catch {
    return null;
  }
}

function downloadName(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `magictech-catalogue-${stamp}.xlsx`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
