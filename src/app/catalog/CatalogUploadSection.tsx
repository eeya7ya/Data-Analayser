"use client";

import { useCallback, useState } from "react";
import CatalogueUpload from "@/components/CatalogueUpload";

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
 */
export default function CatalogUploadSection() {
  const [show, setShow] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportCatalogue = useCallback(async () => {
    setExporting(true);
    setExportError(null);
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

      // `xlsx` is ~900 KB gzipped; load it only when the admin actually
      // clicks Export so the page paints fast for read-only users.
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
      // Readable column widths — tuned to the most common content lengths
      // so the file opens nicely in Excel/Sheets without manual resizing.
      ws["!cols"] = [
        { wch: 14 }, // vendor
        { wch: 18 }, // system
        { wch: 18 }, // category
        { wch: 18 }, // sub_category
        { wch: 22 }, // fast_view
        { wch: 24 }, // model
        { wch: 48 }, // description
        { wch: 10 }, // currency
        { wch: 12 }, // price_si
        { wch: 40 }, // specifications
      ];
      // JOD/USD price column as a number with 2 decimals.
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

      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      XLSX.writeFile(wb, `magictech-catalogue-${stamp}.xlsx`);
    } catch (err) {
      setExportError((err as Error).message || "Export failed");
    } finally {
      setExporting(false);
    }
  }, []);

  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={exportCatalogue}
          disabled={exporting}
          title="Download the current catalogue as an Excel file. Edit it and re-upload to apply your changes."
          className="rounded-lg border border-magic-border bg-white px-4 py-2 text-sm font-semibold text-magic-ink hover:bg-magic-soft transition-colors disabled:opacity-50"
        >
          {exporting ? "Preparing…" : "Export catalogue (Excel)"}
        </button>
        <button
          onClick={() => setShow((v) => !v)}
          className="rounded-lg border border-magic-border bg-white px-4 py-2 text-sm font-semibold text-magic-ink hover:bg-magic-soft transition-colors"
        >
          {show ? "Hide upload" : "Upload Excel catalogue"}
        </button>
        <span className="text-[11px] text-magic-ink/50">
          Exported rows are matched by <b>model</b> on re-import — edit values in
          Excel and upload the file again to update the catalogue.
        </span>
      </div>
      {exportError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {exportError}
        </div>
      )}
      {show && (
        <div className="mt-2">
          <CatalogueUpload
            onDone={() => {
              setShow(false);
              window.location.reload();
            }}
          />
        </div>
      )}
    </div>
  );
}
