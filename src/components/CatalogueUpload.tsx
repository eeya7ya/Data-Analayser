"use client";

import { useState, useCallback, useMemo } from "react";
import { compressDataUrl } from "@/components/QuotationPreview";
import { extractWorksheetImages } from "@/lib/xlsxImages";
import { fingerprintRow } from "@/lib/catalogueFingerprint";

/**
 * `xlsx` is ~900 KB gzipped and is only needed if the user actually picks
 * an Excel file to upload. Eagerly importing it at module scope dragged
 * the entire parser into the /catalog initial JS bundle, doubling the
 * page's time-to-interactive for every visit — including read-only users
 * who will never touch this widget. Load it on demand inside `parseFile`
 * so the catalog page paints fast and the cost is only paid once, when
 * the admin clicks "Choose file".
 */
type XlsxModule = typeof import("xlsx");
let xlsxPromise: Promise<XlsxModule> | null = null;
function loadXlsx(): Promise<XlsxModule> {
  if (!xlsxPromise) xlsxPromise = import("xlsx");
  return xlsxPromise;
}

/** Matches the per-row PATCH endpoint's cap; gives base64 some headroom. */
const PICTURE_MAX_BYTES = 200_000;

/** Expected Excel columns (case-insensitive matching). */
const EXPECTED_COLUMNS = [
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
] as const;

/** Column aliases for flexible header matching. */
const ALIASES: Record<string, string> = {
  "fast view": "fast_view",
  fastview: "fast_view",
  "sub category": "sub_category",
  subcategory: "sub_category",
  "price si": "price_si",
  pricesi: "price_si",
  price: "price_si",
  spec: "specifications",
  specs: "specifications",
};

interface ParsedRow {
  vendor: string;
  system: string;
  category: string;
  sub_category: string;
  fast_view: string;
  model: string;
  description: string;
  currency: string;
  price_si: number;
  specifications: string;
  picture_url?: string;
}

function normalizeHeader(h: string): string {
  const lower = h.trim().toLowerCase().replace(/[^a-z0-9_]/g, " ").replace(/\s+/g, " ").trim();
  if (EXPECTED_COLUMNS.includes(lower as (typeof EXPECTED_COLUMNS)[number])) return lower;
  const noSpace = lower.replace(/\s/g, "");
  if (EXPECTED_COLUMNS.includes(noSpace as (typeof EXPECTED_COLUMNS)[number])) return noSpace;
  return ALIASES[lower] || ALIASES[noSpace] || lower;
}

export default function CatalogueUpload({ onDone }: { onDone?: () => void }) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; upserted?: number; duplicatesRemoved?: number; error?: string } | null>(null);
  const [headerMap, setHeaderMap] = useState<Record<string, string>>({});
  const [pictureCount, setPictureCount] = useState(0);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  // Change-detection: fingerprints of the CURRENT catalogue, keyed by model.
  // `null` = not loaded (or the endpoint is unavailable) → fall back to
  // uploading every row, the previous behaviour.
  const [fingerprints, setFingerprints] = useState<Record<
    string,
    { t: string; p: 0 | 1 }
  > | null>(null);
  const [fpStatus, setFpStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  // When on, also re-upload rows that carry an embedded picture, so edited
  // images get pushed. Off by default: pictures re-compress on every import, so
  // they can't be diffed and would otherwise force the whole catalogue up.
  const [refreshImages, setRefreshImages] = useState(false);

  // Split the parsed rows against the current catalogue into: new (model not in
  // catalogue), changed (a data field differs, or a picture was added to a row
  // that had none), imageRefresh (data unchanged but re-sent only because the
  // "also re-upload pictures" box is ticked), and unchanged (skipped). Falls
  // back to all-rows when fingerprints aren't available (older backend).
  const { toUpload, newCount, changedCount, imageRefreshCount, unchangedCount } =
    useMemo(() => {
      if (!fingerprints) {
        return {
          toUpload: rows,
          newCount: rows.length,
          changedCount: 0,
          imageRefreshCount: 0,
          unchangedCount: 0,
        };
      }
      const upload: ParsedRow[] = [];
      let nNew = 0;
      let nChanged = 0;
      let nImage = 0;
      let nUnchanged = 0;
      for (const r of rows) {
        const existing = fingerprints[r.model];
        if (!existing) {
          nNew += 1;
          upload.push(r);
          continue;
        }
        const dataChanged = fingerprintRow(r) !== existing.t;
        const pictureAdded = Boolean(r.picture_url) && existing.p === 0;
        if (dataChanged || pictureAdded) {
          nChanged += 1;
          upload.push(r);
          continue;
        }
        // Data is identical. Only re-send it if the user opted to refresh
        // images AND this row actually carries a picture.
        if (refreshImages && Boolean(r.picture_url)) {
          nImage += 1;
          upload.push(r);
          continue;
        }
        nUnchanged += 1;
      }
      return {
        toUpload: upload,
        newCount: nNew,
        changedCount: nChanged,
        imageRefreshCount: nImage,
        unchangedCount: nUnchanged,
      };
    }, [rows, fingerprints, refreshImages]);

  const parseFile = useCallback((file: File) => {
    setError(null);
    setResult(null);
    setFileName(file.name);
    setPictureCount(0);

    // Fetch the current catalogue's change-detection fingerprints in parallel
    // with parsing so re-imported rows that haven't changed can be skipped. If
    // it fails (older backend without the endpoint), fingerprints stay null and
    // every row is uploaded, exactly as before.
    setFingerprints(null);
    setFpStatus("loading");
    // Time-box the compare so a slow/hung request falls back to uploading all
    // rows instead of leaving the button stuck on "Comparing…".
    const fpAbort = new AbortController();
    const fpTimeout = setTimeout(() => fpAbort.abort(), 20_000);
    fetch("/api/catalogue/fingerprints", { signal: fpAbort.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          fingerprints?: Record<string, { t: string; p: 0 | 1 }>;
        };
        setFingerprints(data.fingerprints ?? {});
        setFpStatus("ready");
      })
      .catch(() => {
        setFingerprints(null);
        setFpStatus("error");
      })
      .finally(() => clearTimeout(fpTimeout));

    // Kick off the xlsx dynamic import in parallel with the FileReader so
    // the two wait times overlap instead of stacking serially.
    const xlsxReady = loadXlsx();

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const XLSX = await xlsxReady;
        const buffer = e.target?.result as ArrayBuffer;
        const data = new Uint8Array(buffer);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) {
          setError("No sheets found in the Excel file.");
          return;
        }

        // `blankrows: true` keeps blank rows as `{}` so each entry's array
        // index lines up with its xlsx row (raw[N] = xlsx data row N + 1).
        // Without this, blank rows are silently dropped and the drawing-row
        // mapping for embedded pictures would slide out of sync. Empty
        // rows are filtered later, after pictures are attached by index.
        const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
          defval: "",
          blankrows: true,
        });
        if (raw.length === 0) {
          setError("The sheet is empty.");
          return;
        }

        // Map headers — pick the first non-empty row for key inference,
        // since `blankrows: true` can hand us `{}` placeholders.
        const firstReal = raw.find((r) => Object.keys(r).length > 0) || raw[0];
        const originalHeaders = Object.keys(firstReal);
        const mapped: Record<string, string> = {};
        for (const h of originalHeaders) {
          mapped[h] = normalizeHeader(h);
        }
        setHeaderMap(mapped);

        // Check required columns
        const mappedValues = new Set(Object.values(mapped));
        const missing = ["vendor", "model"].filter((c) => !mappedValues.has(c));
        if (missing.length) {
          setError(`Missing required columns: ${missing.join(", ")}. Found: ${originalHeaders.join(", ")}`);
          return;
        }

        // Pull embedded pictures out of the .xlsx in parallel with the
        // text parsing. Drawing rows are zero-indexed, header is on row 0,
        // so data row index N in `raw` corresponds to drawing row N + 1.
        // .slice() the buffer because XLSX.read may detach the original
        // ArrayBuffer on some runtimes.
        const imagesByDrawingRow = await extractWorksheetImages(
          buffer.slice(0),
        );

        // Parse rows
        const parsed: ParsedRow[] = raw.map((r) => {
          const get = (col: string): string => {
            for (const [orig, norm] of Object.entries(mapped)) {
              if (norm === col) return String(r[orig] ?? "").trim();
            }
            return "";
          };
          const priceRaw = get("price_si");
          return {
            vendor: get("vendor"),
            system: get("system"),
            category: get("category"),
            sub_category: get("sub_category"),
            fast_view: get("fast_view"),
            model: get("model"),
            description: get("description"),
            currency: get("currency") || "USD",
            price_si: parseFloat(priceRaw) || 0,
            specifications: get("specifications"),
          };
        });

        // Attach + compress pictures by row index. Drop anything still
        // over the size cap so the row uploads fine without it instead of
        // the whole upload failing.
        let attached = 0;
        for (let i = 0; i < parsed.length; i++) {
          const dataUrl = imagesByDrawingRow.get(i + 1);
          if (!dataUrl) continue;
          try {
            const compressed = await compressDataUrl(dataUrl);
            if (compressed.length <= PICTURE_MAX_BYTES) {
              parsed[i].picture_url = compressed;
              attached += 1;
            }
          } catch {
            // ignore — the row still uploads without a picture
          }
        }
        setPictureCount(attached);

        const valid = parsed.filter((r) => r.vendor && r.model);
        setRows(valid);
        if (valid.length < parsed.length) {
          setError(`${parsed.length - valid.length} row(s) skipped (missing vendor or model).`);
        }
      } catch (err) {
        setError(`Failed to parse file: ${(err as Error).message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const upload = useCallback(async () => {
    // Only the new/changed rows are uploaded; unchanged existing products are
    // skipped so a re-import touches just what actually changed.
    const uploadRows = toUpload;
    if (uploadRows.length === 0) return;
    setUploading(true);
    setUploadProgress({ done: 0, total: uploadRows.length });
    setResult(null);
    setError(null);

    // Vercel serverless functions cap request bodies at ~4.5 MB. With
    // embedded pictures a single POST of 2000+ rows easily blows past
    // that and the platform returns "Request Entity Too Large" (plain
    // text), which the client then chokes on as invalid JSON. Pack rows
    // into ≤BATCH_BYTES JSON chunks so each request stays comfortably
    // under the cap, and POST them in sequence so a mid-upload failure
    // tells us exactly how far we got.
    const BATCH_BYTES = 3_000_000;
    const batches: ParsedRow[][] = [];
    let current: ParsedRow[] = [];
    let currentBytes = 2; // "[]" framing
    for (const r of uploadRows) {
      const rowBytes = JSON.stringify(r).length + 1; // +1 for the comma
      // A single row can exceed the cap only if its picture is huge —
      // shouldn't happen post-compress, but if it does, send it alone
      // and let the server reject just that batch.
      if (current.length > 0 && currentBytes + rowBytes > BATCH_BYTES) {
        batches.push(current);
        current = [];
        currentBytes = 2;
      }
      current.push(r);
      currentBytes += rowBytes;
    }
    if (current.length > 0) batches.push(current);

    try {
      let upserted = 0;
      let duplicatesRemoved = 0;
      let processed = 0;
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const res = await fetch("/api/catalogue/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: batch }),
        });
        // Read body as text first so a non-JSON error (HTML, "Request
        // Entity Too Large", etc.) surfaces as a useful message instead
        // of a JSON.parse exception.
        const text = await res.text();
        let data: { error?: string; upserted?: number; duplicatesRemoved?: number } = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = { error: text.slice(0, 200) || `HTTP ${res.status}` };
        }
        if (!res.ok) {
          setResult({
            ok: false,
            error: `Batch ${i + 1}/${batches.length} failed: ${data.error || `HTTP ${res.status}`}. ${upserted} row(s) uploaded before the failure.`,
          });
          return;
        }
        upserted += data.upserted || 0;
        duplicatesRemoved += data.duplicatesRemoved || 0;
        processed += batch.length;
        setUploadProgress({ done: processed, total: uploadRows.length });
      }
      setResult({ ok: true, upserted, duplicatesRemoved });
      setRows([]);
      setFileName("");
      setFingerprints(null);
      setFpStatus("idle");
      onDone?.();
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
    } finally {
      setUploading(false);
    }
  }, [toUpload, onDone]);

  return (
    <div className="rounded-2xl border border-magic-border bg-white p-6">
      <h2 className="text-lg font-bold text-magic-ink mb-1">Upload Product Catalogue</h2>
      <p className="text-xs text-magic-ink/60 mb-4">
        Upload an Excel file (.xlsx / .xls) with columns:{" "}
        <span className="font-mono text-magic-ink/80">
          vendor, System, Category, sub_category, Fast View, model, description, currency, price_si, Specifications
        </span>
        . Products are matched by <b>model</b>: only new and changed rows are
        uploaded — existing products that haven&apos;t changed are skipped.
      </p>

      {/* File picker */}
      <div className="flex items-center gap-3 mb-4">
        <label className="cursor-pointer rounded-lg bg-magic-red px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors">
          Choose file
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) parseFile(f);
              e.target.value = "";
            }}
          />
        </label>
        {fileName && (
          <span className="text-sm text-magic-ink/70">{fileName}</span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div
          className={`mb-4 rounded-lg px-4 py-2 text-sm border ${
            result.ok
              ? "bg-green-50 border-green-200 text-green-700"
              : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          {result.ok
            ? `Successfully uploaded ${result.upserted} product(s).${result.duplicatesRemoved ? ` (${result.duplicatesRemoved} duplicate rows merged)` : ""}`
            : `Upload failed: ${result.error}`}
        </div>
      )}

      {/* Header mapping info */}
      {rows.length > 0 && Object.keys(headerMap).length > 0 && (
        <div className="mb-4 text-xs text-magic-ink/60">
          <span className="font-semibold">Column mapping: </span>
          {Object.entries(headerMap)
            .filter(([orig, norm]) => orig.toLowerCase().replace(/\s/g, "_") !== norm)
            .map(([orig, norm]) => `"${orig}" → ${norm}`)
            .join(", ") || "All columns matched directly."}
          {pictureCount > 0 && (
            <span className="ml-2">
              · <b>{pictureCount}</b> embedded picture{pictureCount === 1 ? "" : "s"} extracted
            </span>
          )}
        </div>
      )}

      {/* Change-detection summary */}
      {rows.length > 0 && (
        <div className="mb-3 rounded-lg border border-magic-border bg-magic-soft/40 px-4 py-3 text-sm">
          {fpStatus === "loading" && (
            <span className="text-magic-ink/60">
              Comparing against the current catalogue…
            </span>
          )}
          {fpStatus === "error" && (
            <span className="text-amber-700">
              Couldn&apos;t compare against the current catalogue — all{" "}
              {rows.length} rows will be uploaded.
            </span>
          )}
          {fpStatus === "ready" && (
            <div className="flex flex-col gap-2">
              <span className="text-magic-ink">
                <b>{newCount}</b> new · <b>{changedCount}</b> changed ·{" "}
                {imageRefreshCount > 0 && (
                  <>
                    <b>{imageRefreshCount}</b> image re-push ·{" "}
                  </>
                )}
                <b>{unchangedCount}</b> unchanged{" "}
                <span className="text-magic-ink/50">(skipped)</span>
              </span>
              <label className="inline-flex items-center gap-1.5 text-xs text-magic-ink/70">
                <input
                  type="checkbox"
                  checked={refreshImages}
                  onChange={(e) => setRefreshImages(e.target.checked)}
                  disabled={uploading}
                />
                Also re-upload rows with pictures to push edited images
                {refreshImages && changedCount + newCount === 0 && (
                  <span className="text-amber-700">
                    {" "}— data is unchanged; these {imageRefreshCount} rows are
                    only re-sent to refresh images.
                  </span>
                )}
              </label>
            </div>
          )}
        </div>
      )}

      {/* Preview table */}
      {rows.length > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-magic-ink">
              Preview — {rows.length} product(s)
            </span>
            <button
              onClick={upload}
              disabled={uploading || fpStatus === "loading" || toUpload.length === 0}
              className="rounded-lg bg-magic-red px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {uploading
                ? uploadProgress
                  ? `Uploading… ${uploadProgress.done}/${uploadProgress.total}`
                  : "Uploading…"
                : fpStatus === "loading"
                  ? "Comparing…"
                  : toUpload.length === 0
                    ? "Nothing to update"
                    : `Upload ${toUpload.length} product${toUpload.length === 1 ? "" : "s"}`}
            </button>
          </div>
          <div className="overflow-x-auto max-h-[40vh] overflow-y-auto rounded-lg border border-magic-border">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-magic-soft/80 backdrop-blur">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-magic-ink/60 whitespace-nowrap">
                    picture
                  </th>
                  {EXPECTED_COLUMNS.map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2 text-left font-semibold text-magic-ink/60 whitespace-nowrap"
                    >
                      {col.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((r, i) => (
                  <tr key={i} className="border-t border-magic-border/50 hover:bg-magic-soft/30">
                    <td className="px-3 py-1.5">
                      {r.picture_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.picture_url}
                          alt=""
                          className="h-10 w-10 object-contain rounded border border-magic-border bg-white"
                        />
                      ) : (
                        <span className="text-magic-ink/30">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{r.vendor}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{r.system}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{r.category}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{r.sub_category}</td>
                    <td className="px-3 py-1.5 max-w-[200px] truncate">{r.fast_view}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap font-semibold">{r.model}</td>
                    <td className="px-3 py-1.5 max-w-[200px] truncate">{r.description}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{r.currency}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-magic-red font-semibold">
                      {r.price_si > 0 ? r.price_si.toFixed(2) : "—"}
                    </td>
                    <td className="px-3 py-1.5 max-w-[200px] truncate">{r.specifications}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 100 && (
            <p className="mt-2 text-xs text-magic-ink/50">
              Showing first 100 of {rows.length} rows.
            </p>
          )}
        </>
      )}
    </div>
  );
}
