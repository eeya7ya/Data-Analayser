"use client";

import { useEffect, useRef, useState } from "react";
import { generateOpenPassword, protectPdf } from "@/lib/protectPdf";
import type { WatermarkInfo } from "@/lib/watermark";

/**
 * Read-only PDF export — turns the PDF the browser printed into the
 * watermarked, AES-256 encrypted copy that is sent outside the company.
 *
 * Two steps because a web page can't get hold of the file the browser's
 * "Save as PDF" writes: (1) print / save as usual — that keeps the exact
 * printed layout — then (2) pick that file here and it is watermarked and
 * locked locally (see lib/protectPdf). Nothing is uploaded.
 */
export default function ProtectedPdfDialog({
  open,
  onClose,
  onPrint,
  fileName,
  watermark,
  heading = "Read-only PDF",
}: {
  open: boolean;
  onClose: () => void;
  /** Runs the document's normal print so the user can "Save as PDF". */
  onPrint: () => void;
  /** Download name without extension, e.g. "<REF> - <Project>". */
  fileName: string;
  /** Recipient / REF / date stamped on every page. */
  watermark: WatermarkInfo;
  heading?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setPassword("");
    setBusy(null);
    setError(null);
    setDone(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  function pick(f: File | null | undefined) {
    setError(null);
    setDone(null);
    if (!f) return;
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) {
      setError("Please choose a PDF file.");
      return;
    }
    setFile(f);
  }

  async function run() {
    if (!file) return;
    setError(null);
    setDone(null);
    setBusy("Reading PDF…");
    try {
      const out = await protectPdf(await file.arrayBuffer(), {
        openPassword: password,
        watermark,
        title: fileName,
        onProgress: setBusy,
      });
      const name = `${fileName || "Document"} (Read-only).pdf`;
      const url = URL.createObjectURL(
        new Blob([out as BlobPart], { type: "application/pdf" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setDone(name);
    } catch (err) {
      setError((err as Error).message || "Could not create the PDF.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="protected-pdf-title"
        className="w-full max-w-lg rounded-2xl border border-magic-border bg-white p-5 shadow-xl"
      >
        <h3
          id="protected-pdf-title"
          className="text-base font-semibold text-magic-ink"
        >
          {heading}
        </h3>
        <p className="mt-1 text-xs text-magic-ink/60">
          Read-only, encrypted PDF with the Magic Tech watermark on every page.
          It can be viewed and printed, but not edited or copied from.
        </p>

        <ol className="mt-4 space-y-4 text-sm">
          <li>
            <div className="font-semibold text-magic-ink">1. Save the PDF</div>
            <p className="mt-0.5 text-xs text-magic-ink/60">
              In the print window choose <b>Save as PDF</b> as the destination
              (and leave &ldquo;Headers and footers&rdquo; unticked).
            </p>
            <button
              type="button"
              onClick={onPrint}
              disabled={!!busy}
              className="mt-2 rounded-md border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft disabled:opacity-50"
            >
              Print / Save as PDF
            </button>
          </li>
          <li>
            <div className="font-semibold text-magic-ink">
              2. Choose the saved PDF
            </div>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files?.[0]);
              }}
              onClick={() => inputRef.current?.click()}
              className={`mt-2 cursor-pointer rounded-lg border-2 border-dashed px-3 py-4 text-center text-xs ${
                dragging
                  ? "border-magic-red bg-magic-red/5"
                  : "border-magic-border hover:bg-magic-soft"
              }`}
            >
              {file ? (
                <span className="font-semibold text-magic-ink">{file.name}</span>
              ) : (
                <span className="text-magic-ink/60">
                  Drop the PDF here, or click to choose it
                </span>
              )}
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => {
                  pick(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
          </li>
          <li>
            <div className="font-semibold text-magic-ink">
              3. Password to open <span className="font-normal">(optional)</span>
            </div>
            <p className="mt-0.5 text-xs text-magic-ink/60">
              Leave empty and anyone can open it read-only. With a password,
              nobody can open it without one — send the password separately
              (phone / WhatsApp), never in the same email as the file.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="No password"
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-md border border-magic-border px-3 py-1.5 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setPassword(generateOpenPassword())}
                className="rounded-md border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft"
              >
                Generate
              </button>
            </div>
          </li>
        </ol>

        {error && <p className="mt-3 text-xs text-red-700">{error}</p>}
        {done && (
          <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            Downloaded <b>{done}</b>.
            {password && (
              <>
                {" "}
                Open password: <b className="font-mono">{password}</b>
              </>
            )}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={!!busy}
            className="rounded-md border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft disabled:opacity-50"
          >
            {done ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={() => void run()}
            disabled={!file || !!busy}
            className="rounded-md bg-magic-red px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ?? "Create read-only PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
