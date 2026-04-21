"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { QuotationItem } from "@/components/QuotationPreview";

type XlsxModule = typeof import("xlsx");
let xlsxPromise: Promise<XlsxModule> | null = null;
function loadXlsx(): Promise<XlsxModule> {
  if (!xlsxPromise) xlsxPromise = import("xlsx");
  return xlsxPromise;
}

/** Canonical field keys the importer tries to map to. */
type FieldKey =
  | "brand"
  | "model"
  | "description"
  | "quantity"
  | "unit_price"
  | "total_price"
  | "system"
  | "picture"
  | "delivery";

const FIELD_LABELS: Record<FieldKey, string> = {
  brand: "Brand",
  model: "Model",
  description: "Description",
  quantity: "Quantity",
  unit_price: "Unit Price",
  total_price: "Total Price",
  system: "System / Page",
  picture: "Picture",
  delivery: "Delivery",
};

// Fuzzy header aliases — every incoming header is normalised and tried
// against this list. First match wins. "Brand" and "Vendor" collapse to
// the same canonical key, as do "Qty" and "Quantity", "Price" and
// "Unit Price", etc.
const HEADER_ALIASES: Record<FieldKey, string[]> = {
  brand: ["brand", "vendor", "manufacturer", "make"],
  model: ["model", "part", "partnumber", "part number", "sku", "item", "code"],
  description: ["description", "desc", "details", "item description"],
  quantity: ["quantity", "qty", "qnty", "amount"],
  unit_price: [
    "unit price",
    "unitprice",
    "price",
    "price si",
    "unit cost",
    "cost",
    "rate",
  ],
  total_price: ["total price", "total", "totalprice", "line total", "amount total"],
  system: ["system", "page", "category", "group", "section"],
  picture: ["picture", "image", "img", "photo"],
  delivery: ["delivery", "lead time", "availability"],
};

interface DetectedRow {
  /** One string per original column, aligned with `headers`. */
  values: string[];
}

interface Props {
  /** Default page name applied when the sheet has no System column. */
  defaultPage: string;
  /** Existing pages shown as quick-pick options in the page picker. */
  existingPages: string[];
  onCancel: () => void;
  /**
   * Called once the user has reviewed the mapping and clicked Import.
   * `mode` decides whether to append to the existing items list or
   * replace it.
   */
  onImport: (items: QuotationItem[], mode: "append" | "replace") => void;
}

function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function detectField(header: string): FieldKey | null {
  const norm = normalizeHeader(header);
  if (!norm) return null;
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [FieldKey, string[]]
  >) {
    for (const alias of aliases) {
      if (norm === alias) return key;
    }
  }
  // Secondary pass — "contains" matching so "Unit price (JOD)" still hits
  // unit_price even though it isn't an exact alias.
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [FieldKey, string[]]
  >) {
    for (const alias of aliases) {
      if (norm.includes(alias)) return key;
    }
  }
  return null;
}

function parseNumber(v: string): number {
  if (!v) return 0;
  // Strip currency codes (JOD, USD, $, €, …) and thousand separators.
  const cleaned = v
    .replace(/[a-zA-Z$€£¥]+/g, "")
    .replace(/,/g, "")
    .trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function valueLooksOptional(v: string): boolean {
  return /optional/i.test(v.trim());
}

/**
 * Scan the first rows of a sheet and find the one that most resembles a
 * header row (highest count of recognisable field names). Returns the
 * zero-based index, or -1 if nothing looks plausible.
 */
function findHeaderRow(rows: string[][]): number {
  let bestIdx = -1;
  let bestScore = 0;
  // Widened from 15 → 30 so sheets with a title block or metadata header
  // above the table still resolve their real column row.
  const maxScan = Math.min(rows.length, 30);
  for (let i = 0; i < maxScan; i++) {
    const row = rows[i] || [];
    let score = 0;
    for (const cell of row) {
      if (detectField(cell)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  // Require at least two recognisable headers — a single-column match
  // tends to be a stray label in the data area, not a real header row.
  return bestScore >= 2 ? bestIdx : -1;
}

export default function ExcelImportModal({
  defaultPage,
  existingPages,
  onCancel,
  onImport,
}: Props) {
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<DetectedRow[]>([]);
  const [mapping, setMapping] = useState<Record<number, FieldKey | "">>({});
  const [pageName, setPageName] = useState(defaultPage || "");
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [parsing, setParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const mappedFields = useMemo(() => {
    const set = new Set<FieldKey>();
    for (const v of Object.values(mapping)) {
      if (v) set.add(v as FieldKey);
    }
    return set;
  }, [mapping]);

  // Previously required mappedFields.has("model") — which blocked the
  // Import button for sheets that use Brand + Description only. We now
  // let the user click as long as at least one text column is mapped;
  // handleImport below still reports a clear error if the mapping
  // produces zero items.
  const canImport =
    rows.length > 0 &&
    (mappedFields.has("model") ||
      mappedFields.has("description") ||
      mappedFields.has("brand"));

  const parseFile = useCallback((file: File) => {
    setError(null);
    setFileName(file.name);
    setParsing(true);
    setHeaders([]);
    setRows([]);
    setMapping({});
    const xlsxReady = loadXlsx();

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const XLSX = await xlsxReady;
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        if (!wb.SheetNames || wb.SheetNames.length === 0) {
          setError("No sheets found in the file.");
          setParsing(false);
          return;
        }

        // Walk every sheet in the workbook and keep the first one whose
        // header detector actually fires. Plenty of real-world quotation
        // sheets stash the table on "Sheet2" or "Items" with a cover
        // sheet in front, and only scanning SheetNames[0] would silently
        // refuse to import those files.
        let chosenSheetName = "";
        let chosenHeaderIdx = -1;
        let chosenStringified: string[][] = [];
        const scanSummaries: string[] = [];
        for (const name of wb.SheetNames) {
          const sheet = wb.Sheets[name];
          if (!sheet) continue;
          const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            defval: "",
            blankrows: false,
          }) as unknown[][];
          const stringified: string[][] = aoa.map((row) =>
            (row || []).map((cell) =>
              cell === null || cell === undefined ? "" : String(cell).trim(),
            ),
          );
          scanSummaries.push(`${name}:${stringified.length}rows`);
          if (stringified.length === 0) continue;
          const idx = findHeaderRow(stringified);
          if (idx >= 0) {
            chosenSheetName = name;
            chosenHeaderIdx = idx;
            chosenStringified = stringified;
            break;
          }
        }

        if (chosenHeaderIdx < 0) {
          setError(
            `Couldn't find a header row with recognisable column names in any sheet (${scanSummaries.join(", ")}). Expected headers like Brand, Model, Description, Quantity, Unit Price.`,
          );
          setParsing(false);
          return;
        }

        const rawHeaders = chosenStringified[chosenHeaderIdx];
        // Pad every data row to the header length so missing trailing
        // cells don't offset the mapping.
        const colCount = rawHeaders.length;
        const dataRows = chosenStringified
          .slice(chosenHeaderIdx + 1)
          .filter((r) => r.some((c) => c && c.trim().length > 0))
          .map((r) => {
            const padded = r.slice(0, colCount);
            while (padded.length < colCount) padded.push("");
            return { values: padded };
          });

        const autoMap: Record<number, FieldKey | ""> = {};
        rawHeaders.forEach((h, i) => {
          const detected = detectField(h);
          autoMap[i] = detected ?? "";
        });

        // Surface a diagnostic to the console so users (and support) can
        // tell at a glance where things landed if the Import button is
        // still disabled — the most common cause of "nothing happened" is
        // a mapping miss the user didn't notice.
        if (typeof console !== "undefined") {
          // eslint-disable-next-line no-console
          console.log("[Import Excel] parsed", {
            file: file.name,
            sheet: chosenSheetName,
            headerRow: chosenHeaderIdx,
            headers: rawHeaders,
            dataRowCount: dataRows.length,
            autoMap,
          });
        }

        setHeaders(rawHeaders);
        setRows(dataRows);
        setMapping(autoMap);
        setParsing(false);
      } catch (err) {
        setError(`Failed to parse file: ${(err as Error).message}`);
        setParsing(false);
      }
    };
    reader.onerror = () => {
      setError("Could not read the file.");
      setParsing(false);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  /**
   * Convert the parsed-and-mapped rows into QuotationItems according to
   * the current column mapping. Kept as a pure function (no state
   * mutation) so it can be reused by the live preview counter and by
   * the actual import handler below — keeps the two in lock-step.
   */
  const buildItems = useCallback((): QuotationItem[] => {
    if (rows.length === 0) return [];
    const colFor = (field: FieldKey): number => {
      for (const [idx, v] of Object.entries(mapping)) {
        if (v === field) return Number(idx);
      }
      return -1;
    };
    const brandCol = colFor("brand");
    const modelCol = colFor("model");
    const descCol = colFor("description");
    const qtyCol = colFor("quantity");
    const unitCol = colFor("unit_price");
    const totalCol = colFor("total_price");
    const sysCol = colFor("system");
    const deliveryCol = colFor("delivery");
    const pictureCol = colFor("picture");

    const fallbackPage = (pageName || defaultPage || "General").trim();

    const items: QuotationItem[] = [];
    for (const r of rows) {
      const v = r.values;
      const model = modelCol >= 0 ? v[modelCol] : "";
      const description = descCol >= 0 ? v[descCol] : "";
      const brand = brandCol >= 0 ? v[brandCol] : "";
      // Relaxed from the previous "needs model OR description": if none
      // of those three is present we skip the row, but having just a
      // brand + qty + price is enough — matches loose sheets where the
      // description lives in the Model cell, or vice versa.
      if (!model && !description && !brand) continue;

      const qtyStr = qtyCol >= 0 ? v[qtyCol] : "";
      const unitStr = unitCol >= 0 ? v[unitCol] : "";
      const totalStr = totalCol >= 0 ? v[totalCol] : "";
      const sysStr = sysCol >= 0 ? v[sysCol] : "";
      const delivery = deliveryCol >= 0 ? v[deliveryCol] : "Available";
      const picture = pictureCol >= 0 ? v[pictureCol] : "";

      const quantity = Math.max(1, Math.round(parseNumber(qtyStr) || 1));
      let unit_price = parseNumber(unitStr);
      const totalNum = parseNumber(totalStr);
      // If the sheet only supplied a Total column (e.g. no Unit Price),
      // back-calculate the per-unit price from total ÷ qty. Guards
      // against qty=0 which would divide to NaN.
      if (unit_price === 0 && totalNum > 0 && quantity > 0) {
        unit_price = Number((totalNum / quantity).toFixed(2));
      }
      const optional = valueLooksOptional(totalStr);

      const sys = (sysStr || "").trim() || fallbackPage;
      const pictureUrl =
        picture && /^https?:|^data:/i.test(picture) ? picture : undefined;

      items.push({
        no: 0,
        system: sys,
        brand: (brand || "").trim(),
        model: (model || "").trim(),
        description: (description || "").trim(),
        quantity,
        unit_price,
        delivery: (delivery || "").trim() || "Available",
        picture_url: pictureUrl,
        price_si: unit_price,
        optional: optional || undefined,
      });
    }
    return items;
  }, [rows, mapping, pageName, defaultPage]);

  // Live count of what the current mapping would produce — drives the
  // "N rows will become items" hint and the Import button label. Keeps
  // the user from clicking Import only to be told "nothing matched".
  const previewItemCount = useMemo(() => buildItems().length, [buildItems]);

  const handleImport = useCallback(() => {
    if (rows.length === 0) return;
    const items = buildItems();
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.log("[Import Excel] importing", {
        rows: rows.length,
        items: items.length,
        mode,
        firstItem: items[0],
      });
    }
    if (items.length === 0) {
      const missing: string[] = [];
      if (!mappedFields.has("model")) missing.push("Model");
      if (!mappedFields.has("description")) missing.push("Description");
      setError(
        `No rows could be turned into items. ${rows.length} data row${rows.length === 1 ? "" : "s"} scanned; every one was missing a Brand, Model and Description. ` +
          (missing.length > 0
            ? `Map ${missing.join(" or ")} to the column that holds the product identifier, then try again.`
            : "Double-check your column mapping above."),
      );
      return;
    }
    onImport(items, mode);
  }, [rows, buildItems, mode, onImport, mappedFields]);

  const preview = rows.slice(0, 5);

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-4xl rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-magic-ink">
              Import items from Excel
            </h2>
            <p className="mt-1 text-xs text-magic-ink/60">
              Upload a sheet and we&apos;ll auto-detect columns like
              <b> Brand</b>, <b>Model</b>, <b>Description</b>, <b>Quantity</b>,
              and <b>Unit Price</b>. Review the mapping below and click
              Import.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="text-magic-ink/50 hover:text-magic-red text-lg"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) parseFile(f);
            }}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg bg-magic-red text-white px-4 py-2 text-sm font-semibold hover:bg-red-700"
          >
            {fileName ? "Choose a different file" : "Choose Excel / CSV file"}
          </button>
          {fileName && (
            <span className="text-xs text-magic-ink/70">
              <b>{fileName}</b>
              {rows.length > 0 && (
                <span className="text-magic-ink/50">
                  {" "}
                  — {rows.length} data rows detected
                </span>
              )}
            </span>
          )}
          {parsing && (
            <span className="text-xs text-magic-ink/50 animate-pulse">
              Parsing…
            </span>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 text-red-700 border border-red-200 px-3 py-2 text-xs">
            {error}
          </p>
        )}

        {headers.length > 0 && (
          <div className="mt-6 space-y-4">
            <div>
              <h3 className="text-xs font-semibold uppercase text-magic-ink/60 mb-2">
                Column mapping
              </h3>
              <div className="rounded-lg border border-magic-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-magic-soft/60">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-semibold text-magic-ink/70 w-1/3">
                        Sheet column
                      </th>
                      <th className="px-2 py-1.5 text-left font-semibold text-magic-ink/70">
                        Maps to
                      </th>
                      <th className="px-2 py-1.5 text-left font-semibold text-magic-ink/70">
                        Sample value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {headers.map((h, i) => (
                      <tr key={i} className="border-t border-magic-border/50">
                        <td className="px-2 py-1 font-semibold text-magic-ink">
                          {h || <span className="text-magic-ink/40">(blank)</span>}
                        </td>
                        <td className="px-2 py-1">
                          <select
                            value={mapping[i] ?? ""}
                            onChange={(e) =>
                              setMapping((cur) => ({
                                ...cur,
                                [i]: e.target.value as FieldKey | "",
                              }))
                            }
                            className="rounded-md border border-magic-border bg-white px-2 py-0.5 text-xs"
                          >
                            <option value="">— Ignore —</option>
                            {(Object.keys(FIELD_LABELS) as FieldKey[]).map(
                              (k) => (
                                <option key={k} value={k}>
                                  {FIELD_LABELS[k]}
                                </option>
                              ),
                            )}
                          </select>
                        </td>
                        <td className="px-2 py-1 text-magic-ink/60 truncate max-w-xs">
                          {rows[0]?.values[i] || ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-magic-ink/60">
                Map at least one of <b>Model</b>, <b>Description</b> or
                <b> Brand</b> to continue.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">
                  Default page (for rows without a System column)
                </label>
                <input
                  value={pageName}
                  onChange={(e) => setPageName(e.target.value)}
                  list="quick-pages"
                  placeholder="e.g. KNX / Lighting Control"
                  className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
                />
                <datalist id="quick-pages">
                  {existingPages.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">
                  Import mode
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setMode("append")}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                      mode === "append"
                        ? "bg-magic-red text-white border-magic-red"
                        : "bg-white border-magic-border hover:bg-magic-soft"
                    }`}
                  >
                    Append to current
                  </button>
                  <button
                    onClick={() => setMode("replace")}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                      mode === "replace"
                        ? "bg-magic-red text-white border-magic-red"
                        : "bg-white border-magic-border hover:bg-magic-soft"
                    }`}
                  >
                    Replace all
                  </button>
                </div>
              </div>
            </div>

            {preview.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-magic-ink/60 mb-2">
                  Preview (first {preview.length} rows)
                </h3>
                <div className="rounded-lg border border-magic-border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-magic-soft/60">
                      <tr>
                        {headers.map((h, i) => (
                          <th
                            key={i}
                            className="px-2 py-1 text-left font-semibold text-magic-ink/70 whitespace-nowrap"
                          >
                            {h}
                            {mapping[i] && (
                              <span className="ml-1 text-[9px] text-magic-red">
                                →{FIELD_LABELS[mapping[i] as FieldKey]}
                              </span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((r, ri) => (
                        <tr key={ri} className="border-t border-magic-border/50">
                          {r.values.map((c, ci) => (
                            <td
                              key={ci}
                              className="px-2 py-1 text-magic-ink/80 max-w-xs truncate"
                            >
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          {rows.length > 0 && (
            <span className="text-[11px] text-magic-ink/70 mr-auto">
              <b>{previewItemCount}</b> of {rows.length} row
              {rows.length === 1 ? "" : "s"} will be imported
              {previewItemCount < rows.length && (
                <span className="text-magic-ink/50">
                  {" "}
                  ({rows.length - previewItemCount} skipped — empty
                  Brand/Model/Description)
                </span>
              )}
              .
            </span>
          )}
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm text-magic-ink/70 hover:bg-magic-soft"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!canImport || previewItemCount === 0}
            className="rounded-lg bg-magic-red px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Import{previewItemCount > 0 ? ` ${previewItemCount} item${previewItemCount === 1 ? "" : "s"}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
