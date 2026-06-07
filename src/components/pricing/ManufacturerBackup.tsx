"use client";

import { useRef, useState } from "react";
import { Download, Upload, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/pricing/utils";
import Spinner from "@/components/Spinner";

interface Props {
  manufacturerId: number;
  manufacturerName: string;
  /** Called after a successful restore so the caller can refresh the
   *  project list. */
  onRestored?: () => void;
  /** Admin-only: scopes export/restore to a specific owning user so the
   *  admin gets (and writes back) only that user's projects, not the
   *  blended admin view. */
  ownerUserId?: number | null;
}

/**
 * Small toolbar for backing up and restoring all projects in a single
 * manufacturer. Restore always *adds* projects — it never modifies or
 * deletes anything already present, so the current work is safe.
 */
export function ManufacturerBackup({
  manufacturerId,
  manufacturerName,
  onRestored,
  ownerUserId,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<
    | { kind: "success"; text: string }
    | { kind: "error"; text: string }
    | null
  >(null);

  const clearStatusSoon = () => {
    setTimeout(() => setStatus(null), 4000);
  };

  const ownerQuery =
    ownerUserId != null ? `?ownerUserId=${ownerUserId}` : "";

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setStatus(null);
    try {
      const res = await fetch(
        `/api/pricing/manufacturers/${manufacturerId}/backup${ownerQuery}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = manufacturerName
        .replace(/[^a-z0-9-_]+/gi, "-")
        .toLowerCase() || "backup";
      a.download = `${safeName}-projects-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus({ kind: "success", text: "Backup downloaded" });
      clearStatusSoon();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
      clearStatusSoon();
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
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error("Selected file is not valid JSON");
      }

      // Quick sanity-check before hitting the server. Accept both the full
      // backup envelope ({ projects: [...] }) and a bare array of projects.
      const projectsArr = Array.isArray(payload)
        ? payload
        : payload && typeof payload === "object"
          ? (payload as { projects?: unknown }).projects
          : undefined;
      if (!Array.isArray(projectsArr)) {
        throw new Error("Backup file is missing a 'projects' array");
      }

      const projectsCount = projectsArr.length;
      const confirmMsg =
        projectsCount === 0
          ? "The backup file contains no projects. Continue anyway?"
          : `Restore ${projectsCount} project${
              projectsCount === 1 ? "" : "s"
            } into "${manufacturerName}"?\n\nExisting projects will NOT be changed — the restored projects will be added alongside them (with a "(restored …)" suffix).`;
      if (!window.confirm(confirmMsg)) {
        setImporting(false);
        return;
      }

      const res = await fetch(
        `/api/pricing/manufacturers/${manufacturerId}/backup${ownerQuery}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: text,
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Restore failed");
      }
      const data = await res.json();
      if (data.failed > 0) {
        const first = data.failures?.[0];
        setStatus({
          kind: "error",
          text: `Restored ${data.restored}, but ${data.failed} failed${
            first ? `: "${first.name}" — ${first.error}` : ""
          }`,
        });
      } else {
        setStatus({
          kind: "success",
          text: `Restored ${data.restored} project${
            data.restored === 1 ? "" : "s"
          }${data.skipped ? ` (${data.skipped} skipped)` : ""}`,
        });
      }
      clearStatusSoon();
      onRestored?.();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
      clearStatusSoon();
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileChosen(file);
        }}
      />

      <button
        onClick={handleExport}
        disabled={exporting}
        title="Download a JSON backup of every project in this manufacturer"
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 disabled:opacity-60"
      >
        {exporting ? (
          <Spinner size={12} />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        Backup
      </button>

      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={importing}
        title="Restore projects from a backup JSON file — existing projects are untouched"
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-60"
      >
        {importing ? (
          <Spinner size={12} />
        ) : (
          <Upload className="h-3.5 w-3.5" />
        )}
        Restore
      </button>

      {status && (
        <span
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium",
            status.kind === "success"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-rose-50 text-rose-700"
          )}
        >
          {status.kind === "success" ? (
            <Check className="h-3 w-3" />
          ) : (
            <AlertTriangle className="h-3 w-3" />
          )}
          {status.text}
        </span>
      )}
    </div>
  );
}
