"use client";

import { useRef, useState } from "react";
import { Download, Upload, Check, AlertTriangle } from "@/lib/icons";
import { cn } from "@/lib/pricing/utils";
import Spinner from "@/components/Spinner";

type Format = "json" | "csv";

/**
 * Backup / restore toolbar for pricing sheets. `endpoint` decides the scope:
 * one manufacturer (`/api/pricing/manufacturers/:id/backup`) or the whole
 * workspace (`/api/pricing/backup`). Every parameter is exported; restore
 * always ADDS (never overwrites) with a "(restored …)" suffix, so current work
 * is safe. Format is user-selectable: JSON or CSV.
 */
export function PricingBackupToolbar({
  endpoint,
  filenameBase,
  scopeLabel,
  onRestored,
}: {
  endpoint: string;
  filenameBase: string;
  /** e.g. "this manufacturer" or "all manufacturers" — used in the confirm. */
  scopeLabel: string;
  onRestored?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [format, setFormat] = useState<Format>("json");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null);

  const clearSoon = () => setTimeout(() => setStatus(null), 5000);
  const sep = endpoint.includes("?") ? "&" : "?";

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setStatus(null);
    try {
      const res = await fetch(`${endpoint}${sep}format=${format}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Backup failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filenameBase}-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus({ kind: "success", text: `Backup downloaded (${format.toUpperCase()})` });
      clearSoon();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
      clearSoon();
    } finally {
      setExporting(false);
    }
  };

  const handleFileChosen = async (file: File) => {
    if (importing) return;
    setImporting(true);
    setStatus(null);
    try {
      const text = await file.text();
      const isCsv = /\.csv$/i.test(file.name) || text.slice(0, 200).includes("mfg_idx");
      if (
        !window.confirm(
          `Restore this backup into ${scopeLabel}?\n\nExisting sheets are NOT changed — the restored ones are added alongside them (with a "(restored …)" suffix).`,
        )
      ) {
        setImporting(false);
        return;
      }
      const res = await fetch(`${endpoint}${sep}format=${isCsv ? "csv" : "json"}`, {
        method: "POST",
        headers: { "Content-Type": isCsv ? "text/csv" : "application/json" },
        body: text,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Restore failed");
      if (data.failed > 0) {
        const first = data.failures?.[0];
        setStatus({
          kind: "error",
          text: `Restored ${data.restored}, ${data.failed} failed${first ? `: "${first.name}" — ${first.error}` : ""}`,
        });
      } else {
        setStatus({
          kind: "success",
          text: `Restored ${data.restored} sheet${data.restored === 1 ? "" : "s"}${data.skipped ? ` (${data.skipped} skipped)` : ""}`,
        });
      }
      clearSoon();
      onRestored?.();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
      clearSoon();
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.csv,application/json,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFileChosen(f);
        }}
      />

      {/* Format toggle */}
      <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 text-xs">
        {(["json", "csv"] as Format[]).map((f) => (
          <button
            key={f}
            onClick={() => setFormat(f)}
            className={cn(
              "px-2.5 py-1.5 font-semibold uppercase transition-colors",
              format === f ? "bg-cyan-500 text-white" : "bg-white text-gray-500 hover:bg-gray-50",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      <button
        onClick={handleExport}
        disabled={exporting}
        title={`Download a ${format.toUpperCase()} backup of every parameter`}
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 disabled:opacity-60"
      >
        {exporting ? <Spinner size={12} /> : <Download className="h-3.5 w-3.5" />}
        Backup
      </button>

      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={importing}
        title="Restore from a JSON or CSV backup — existing sheets are untouched"
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-60"
      >
        {importing ? <Spinner size={12} /> : <Upload className="h-3.5 w-3.5" />}
        Restore
      </button>

      {status && (
        <span
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium",
            status.kind === "success" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
          )}
        >
          {status.kind === "success" ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {status.text}
        </span>
      )}
    </div>
  );
}

/** Per-manufacturer wrapper (keeps the existing call-site working). */
export function ManufacturerBackup({
  manufacturerId,
  manufacturerName,
  onRestored,
  ownerUserId,
}: {
  manufacturerId: number;
  manufacturerName: string;
  onRestored?: () => void;
  ownerUserId?: number | null;
}) {
  const endpoint =
    ownerUserId != null
      ? `/api/pricing/manufacturers/${manufacturerId}/backup?ownerUserId=${ownerUserId}`
      : `/api/pricing/manufacturers/${manufacturerId}/backup`;
  const safe = manufacturerName.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "backup";
  return (
    <PricingBackupToolbar
      endpoint={endpoint}
      filenameBase={`${safe}-pricing`}
      scopeLabel={`"${manufacturerName}"`}
      onRestored={onRestored}
    />
  );
}
