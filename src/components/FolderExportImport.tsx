"use client";

import { useRef, useState } from "react";

export default function FolderExportImport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  function handleExport() {
    window.location.href = "/api/folders/export";
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setResult(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.version !== 1 && data.version !== 2) {
        throw new Error("Unsupported export version");
      }
      const res = await fetch("/api/folders/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Import failed");
      setResult(
        `Imported: ${json.folders_created} folders, ${json.quotations_created} quotations. Skipped: ${json.quotations_skipped} duplicates.`,
      );
      // Reload after brief delay so user can see result
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setResult(`Error: ${(err as Error).message}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-2">
      {result && (
        <span
          className={`text-xs ${result.startsWith("Error") ? "text-red-600" : "text-green-700"}`}
        >
          {result}
        </span>
      )}
      <button
        onClick={handleExport}
        className="rounded-md border border-magic-border px-3 py-1.5 text-xs hover:bg-magic-soft"
      >
        Export
      </button>
      <button
        onClick={() => fileRef.current?.click()}
        disabled={importing}
        className="rounded-md border border-magic-border px-3 py-1.5 text-xs hover:bg-magic-soft disabled:opacity-50"
      >
        {importing ? "Importing..." : "Import"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json"
        onChange={handleImport}
        className="hidden"
      />
    </div>
  );
}
