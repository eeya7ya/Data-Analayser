"use client";

import { useState, useCallback } from "react";
import * as XLSX from "xlsx";

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
  const [result, setResult] = useState<{ ok: boolean; upserted?: number; error?: string } | null>(null);
  const [headerMap, setHeaderMap] = useState<Record<string, string>>({});

  const parseFile = useCallback((file: File) => {
    setError(null);
    setResult(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) {
          setError("No sheets found in the Excel file.");
          return;
        }

        const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        if (raw.length === 0) {
          setError("The sheet is empty.");
          return;
        }

        // Map headers
        const originalHeaders = Object.keys(raw[0]);
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
    if (rows.length === 0) return;
    setUploading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/catalogue/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, error: data.error || "Upload failed" });
      } else {
        setResult({ ok: true, upserted: data.upserted });
        setRows([]);
        setFileName("");
        onDone?.();
      }
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
    } finally {
      setUploading(false);
    }
  }, [rows, onDone]);

  return (
    <div className="rounded-2xl border border-magic-border bg-white p-6">
      <h2 className="text-lg font-bold text-magic-ink mb-1">Upload Product Catalogue</h2>
      <p className="text-xs text-magic-ink/60 mb-4">
        Upload an Excel file (.xlsx / .xls) with columns:{" "}
        <span className="font-mono text-magic-ink/80">
          vendor, System, Category, sub_category, Fast View, model, description, currency, price_si, Specifications
        </span>
        . Existing products (same vendor + model) will be updated.
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
            ? `Successfully uploaded ${result.upserted} product(s).`
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
              disabled={uploading}
              className="rounded-lg bg-magic-red px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {uploading ? "Uploading…" : `Upload ${rows.length} products`}
            </button>
          </div>
          <div className="overflow-x-auto max-h-[40vh] overflow-y-auto rounded-lg border border-magic-border">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-magic-soft/80 backdrop-blur">
                <tr>
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
