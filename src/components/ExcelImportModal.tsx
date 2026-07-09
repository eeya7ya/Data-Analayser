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
  /** Name of the workbook sheet this row was pulled from. Legacy exports
   *  spread one quotation across several sheets ("Table 1", "Table 2", …),
   *  so we track origin to show it in the preview. */
  sheet?: string;
}

/** A single worksheet reduced to its header row and padded data rows. */
interface ParsedSheet {
  name: string;
  headers: string[];
  rows: string[][];
}

/** Which sheets contributed rows and which were left out, for the note we
 *  show the user after parsing a multi-sheet workbook. */
interface SheetSummary {
  imported: Array<{ name: string; rows: number }>;
  skipped: string[];
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
  const maxScan = Math.min(rows.length, 15);
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

/**
 * Reduce one sheet (already stringified into an array-of-arrays) to its
 * header row plus padded data rows. Returns null when the sheet has no
 * plausible header — e.g. a cover page or a totals/terms footer sheet —
 * so callers can skip it instead of importing garbage rows.
 */
function parseSheet(name: string, stringified: string[][]): ParsedSheet | null {
  if (stringified.length === 0) return null;
  const headerIdx = findHeaderRow(stringified);
  if (headerIdx < 0) return null;
  const rawHeaders = stringified[headerIdx];
  const colCount = rawHeaders.length;
  // Pad every data row to the header length so missing trailing cells
  // don't offset the mapping.
  const rows = stringified
    .slice(headerIdx + 1)
    .filter((r) => r.some((c) => c && c.trim().length > 0))
    .map((r) => {
      const padded = r.slice(0, colCount);
      while (padded.length < colCount) padded.push("");
      return padded;
    });
  return { name, headers: rawHeaders, rows };
}

/**
 * Merge several parsed sheets into a single header + row set. Columns are
 * aligned across sheets by matching normalised header text, so a table that
 * was split across "Table 1", "Table 2", … lines up into one list even when
 * a later sheet's columns are in a slightly different order. Unmatched
 * columns are appended, and each row remembers which sheet it came from.
 */
function mergeSheets(sheets: ParsedSheet[]): {
  headers: string[];
  rows: DetectedRow[];
} {
  // Seed the canonical column order from the richest header layout (most
  // recognisable fields, then most columns) so the best-detected sheet
  // drives the mapping the user reviews.
  const ranked = [...sheets].sort((a, b) => {
    const sa = a.headers.filter((h) => detectField(h)).length;
    const sb = b.headers.filter((h) => detectField(h)).length;
    if (sb !== sa) return sb - sa;
    return b.headers.length - a.headers.length;
  });

  const canonical: string[] = [];
  const keyToIndex = new Map<string, number>();
  // Per-sheet map from that sheet's column index -> canonical column index.
  const columnMap = new Map<ParsedSheet, number[]>();

  for (const sheet of ranked) {
    const map: number[] = [];
    sheet.headers.forEach((h, i) => {
      const key = normalizeHeader(h);
      // Blank headers are never merged — two unrelated empty columns must
      // not collapse into one, so each becomes its own canonical column.
      if (key && keyToIndex.has(key)) {
        map[i] = keyToIndex.get(key)!;
      } else {
        const idx = canonical.length;
        canonical.push(h);
        if (key) keyToIndex.set(key, idx);
        map[i] = idx;
      }
    });
    columnMap.set(sheet, map);
  }

  // Build rows in the original sheet order (Table 1 before Table 2, …) now
  // that the canonical column count is final.
  const rows: DetectedRow[] = [];
  for (const sheet of sheets) {
    const map = columnMap.get(sheet)!;
    for (const raw of sheet.rows) {
      const values = new Array<string>(canonical.length).fill("");
      raw.forEach((cell, i) => {
        const ci = map[i];
        if (ci != null) values[ci] = cell;
      });
      rows.push({ values, sheet: sheet.name });
    }
  }

  return { headers: canonical, rows };
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
  const [sheetSummary, setSheetSummary] = useState<SheetSummary | null>(null);
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

  const canImport = rows.length > 0 && mappedFields.has("model");

  // More than one sheet fed the import — surface the origin sheet in the
  // preview so mixed-sheet rows are traceable.
  const multiSheet = (sheetSummary?.imported.length ?? 0) > 1;

  const parseFile = useCallback((file: File) => {
    setError(null);
    setFileName(file.name);
    setParsing(true);
    // Clear any previously parsed file so a failed re-parse doesn't leave
    // stale headers/rows on screen.
    setHeaders([]);
    setRows([]);
    setMapping({});
    setSheetSummary(null);
    const xlsxReady = loadXlsx();

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const XLSX = await xlsxReady;
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        if (wb.SheetNames.length === 0) {
          setError("No sheets found in the file.");
          setParsing(false);
          return;
        }

        // Walk EVERY sheet — legacy quotations were exported across several
        // sheets ("Table 1", "Table 2", …) and previously only the first was
        // read. Sheets without a recognisable header (cover pages, totals /
        // terms footers) are collected as "skipped" rather than imported as
        // junk rows.
        const parsed: ParsedSheet[] = [];
        const skipped: string[] = [];
        for (const name of wb.SheetNames) {
          const sheet = wb.Sheets[name];
          if (!sheet) {
            skipped.push(name);
            continue;
          }
          const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            defval: "",
            blankrows: false,
          }) as unknown[][];
          const stringified: string[][] = aoa.map((row) =>
            row.map((cell) =>
              cell === null || cell === undefined ? "" : String(cell).trim(),
            ),
          );
          const ps = parseSheet(name, stringified);
          if (ps && ps.rows.length > 0) parsed.push(ps);
          else skipped.push(name);
        }

        if (parsed.length === 0) {
          setError(
            "Couldn't find a header row with recognisable column names in any sheet. Expected headers like Brand, Model, Description, Quantity, Unit Price.",
          );
          setParsing(false);
          return;
        }

        // Align the sheets into one header + row set and auto-detect the
        // field mapping from the merged headers.
        const { headers: canonicalHeaders, rows: combinedRows } =
          mergeSheets(parsed);

        const autoMap: Record<number, FieldKey | ""> = {};
        canonicalHeaders.forEach((h, i) => {
          autoMap[i] = detectField(h) ?? "";
        });

        setHeaders(canonicalHeaders);
        setRows(combinedRows);
        setMapping(autoMap);
        setSheetSummary({
          imported: parsed.map((p) => ({ name: p.name, rows: p.rows.length })),
          skipped,
        });
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

  const handleImport = useCallback(() => {
    if (rows.length === 0) return;
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
      // Skip rows with neither model nor description — they're section
      // separators or stray labels in the source sheet, not real items.
      if (!model && !description) continue;

      const brand = brandCol >= 0 ? v[brandCol] : "";
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
      const pictureUrl = picture && /^https?:|^data:/i.test(picture)
        ? picture
        : undefined;

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

    if (items.length === 0) {
      setError(
        "No valid rows found after mapping — check that the Model column is mapped and data rows aren't empty.",
      );
      return;
    }
    onImport(items, mode);
  }, [rows, mapping, pageName, defaultPage, mode, onImport]);

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

        {sheetSummary &&
          (sheetSummary.imported.length > 1 ||
            sheetSummary.skipped.length > 0) && (
            <div className="mt-3 rounded-lg bg-magic-soft/60 border border-magic-border px-3 py-2 text-[11px] text-magic-ink/70">
              <span className="font-semibold text-magic-ink/80">Sheets:</span>{" "}
              {sheetSummary.imported
                .map(
                  (s) => `${s.name} (${s.rows} row${s.rows === 1 ? "" : "s"})`,
                )
                .join(", ")}
              {sheetSummary.skipped.length > 0 && (
                <>
                  {" · "}
                  <span className="text-magic-ink/50">
                    skipped {sheetSummary.skipped.join(", ")} — no recognisable
                    header row
                  </span>
                </>
              )}
            </div>
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
              {!mappedFields.has("model") && (
                <p className="mt-2 text-[11px] text-red-600">
                  Map at least the <b>Model</b> column before importing.
                </p>
              )}
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
                        {multiSheet && (
                          <th className="px-2 py-1 text-left font-semibold text-magic-ink/70 whitespace-nowrap">
                            Sheet
                          </th>
                        )}
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
                          {multiSheet && (
                            <td className="px-2 py-1 text-magic-ink/50 whitespace-nowrap">
                              {r.sheet || ""}
                            </td>
                          )}
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

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm text-magic-ink/70 hover:bg-magic-soft"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!canImport}
            className="rounded-lg bg-magic-red px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Import {rows.length > 0 ? `${rows.length} row${rows.length === 1 ? "" : "s"}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
