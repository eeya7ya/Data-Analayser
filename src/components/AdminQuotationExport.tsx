"use client";

import { useState } from "react";

/**
 * Admin-only bulk export of every quotation in the database to PDF.
 *
 * Approach (chosen for "no infra changes"):
 *   - Open each quotation in a hidden, same-origin iframe pointed at
 *     `/quotation?id=<n>`. That route already renders the read-only
 *     printable view of a quotation via QuotationViewer.
 *   - Once the iframe finishes loading (images + fonts settled), walk
 *     every `.quotation-sheet` element inside the iframe document and
 *     capture each one to a canvas with html2canvas at 2× DPR.
 *   - Compose a multi-page A4 PDF with jsPDF — one .quotation-sheet
 *     per PDF page.
 *   - Add the PDF blob to a JSZip archive at
 *     `<client_folder>/<ref>.pdf`. Quotations with no folder land under
 *     "Unfiled".
 *   - When every row is rendered, generate the ZIP and trigger a
 *     browser download.
 *
 * The libraries (`jszip`, `jspdf`, `html2canvas`) are dynamic-imported
 * so they don't get pulled into the bundle for users who never click
 * the export button — which is everyone except admins doing a periodic
 * archive.
 */
export default function AdminQuotationExport() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    label: string;
  } | null>(null);
  const [errors, setErrors] = useState<Array<{ ref: string; message: string }>>([]);
  const [done, setDone] = useState(false);

  async function exportAll() {
    setRunning(true);
    setErrors([]);
    setDone(false);
    setProgress({ current: 0, total: 0, label: "Loading quotation list…" });

    let iframe: HTMLIFrameElement | null = null;
    try {
      // Dynamic import keeps the export deps out of every page's
      // bundle — they're only fetched on first click of this button.
      const [
        { default: JSZip },
        jsPDFModule,
        html2canvasModule,
      ] = await Promise.all([
        import("jszip"),
        import("jspdf"),
        import("html2canvas"),
      ]);
      // jspdf and html2canvas both ship default + named exports; pick
      // whichever is callable so the import shape is forgiving.
      const jsPDF =
        (jsPDFModule as unknown as { default?: typeof import("jspdf").jsPDF; jsPDF?: typeof import("jspdf").jsPDF })
          .default ||
        (jsPDFModule as unknown as { jsPDF: typeof import("jspdf").jsPDF }).jsPDF;
      const html2canvas =
        (html2canvasModule as unknown as { default?: typeof import("html2canvas") })
          .default ||
        (html2canvasModule as unknown as typeof import("html2canvas"));

      const listRes = await fetch("/api/quotations", { cache: "no-store" });
      if (!listRes.ok) {
        throw new Error(`Failed to fetch quotation list (${listRes.status})`);
      }
      const listData = (await listRes.json()) as {
        quotations: Array<{
          id: number;
          ref: string;
          client_name: string | null;
          folder_id: number | null;
        }>;
      };
      const list = listData.quotations || [];
      if (list.length === 0) {
        throw new Error("No quotations to export.");
      }

      // Folder name lookup so the ZIP top-level matches what the user
      // sees in the Clients sidebar — relying on `client_name` alone
      // would split rows that share a company across slightly-different
      // free-text variants.
      const foldersRes = await fetch("/api/folders", { cache: "no-store" });
      const foldersData = (await foldersRes.json()) as {
        folders: Array<{ id: number; name: string }>;
      };
      const folderMap = new Map<number, string>();
      for (const f of foldersData.folders || []) {
        folderMap.set(f.id, f.name);
      }

      const zip = new JSZip();
      setProgress({ current: 0, total: list.length, label: list[0]?.ref || "" });

      // One reusable hidden iframe for the whole run. Reusing it avoids
      // tearing down React/HMR state between rows and keeps the
      // browser's memory pressure flat.
      iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.left = "-10000px";
      iframe.style.top = "0";
      iframe.style.border = "0";
      // A4 portrait is ~794 px at 96 DPI; pad a bit so the quotation
      // sheet's CSS doesn't reflow into a narrower viewport.
      iframe.style.width = "900px";
      iframe.style.height = "1400px";
      iframe.setAttribute("aria-hidden", "true");
      document.body.appendChild(iframe);

      for (let i = 0; i < list.length; i++) {
        const q = list[i];
        setProgress({
          current: i + 1,
          total: list.length,
          label: q.ref || `#${q.id}`,
        });
        try {
          await loadIframe(iframe, `/quotation?id=${q.id}`);
          // Give the React tree + lazy images time to settle. The
          // viewer also kicks off a /api/quotations?id=… fetch on
          // mount, so we wait for that to finish before snapshotting.
          await waitForRender(iframe);

          const doc = iframe.contentDocument;
          if (!doc) throw new Error("iframe document unreachable");
          const sheets = Array.from(
            doc.querySelectorAll(".quotation-sheet"),
          ) as HTMLElement[];
          if (sheets.length === 0) {
            throw new Error("no rendered sheets");
          }

          const pdf = new jsPDF({
            orientation: "portrait",
            unit: "mm",
            format: "a4",
          });
          for (let s = 0; s < sheets.length; s++) {
            const canvas = await html2canvas(sheets[s], {
              scale: 2,
              useCORS: true,
              logging: false,
              backgroundColor: "#ffffff",
              // Pass through the iframe window so html2canvas measures
              // against the iframe's viewport instead of the host page.
              windowWidth: iframe.contentWindow?.innerWidth || 900,
              windowHeight: iframe.contentWindow?.innerHeight || 1400,
            });
            const imgData = canvas.toDataURL("image/jpeg", 0.92);
            if (s > 0) pdf.addPage();
            // A4 portrait: 210 mm × 297 mm — stretch each captured
            // sheet edge-to-edge so the PDF matches a printed page.
            pdf.addImage(imgData, "JPEG", 0, 0, 210, 297);
          }
          const pdfBlob = pdf.output("blob");

          const folderName =
            (q.folder_id != null && folderMap.get(q.folder_id)) ||
            q.client_name ||
            "Unfiled";
          const safeFolder = sanitizePath(folderName);
          const safeRef = sanitizePath(q.ref || `quotation-${q.id}`);
          zip.file(`${safeFolder}/${safeRef}.pdf`, pdfBlob);
        } catch (err) {
          setErrors((prev) => [
            ...prev,
            { ref: q.ref || `#${q.id}`, message: (err as Error).message },
          ]);
        }
      }

      setProgress({
        current: list.length,
        total: list.length,
        label: "Building ZIP…",
      });
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quotations-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Defer the revoke a tick so Chrome has actually started the
      // download before the blob disappears.
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      setDone(true);
    } catch (err) {
      setErrors((prev) => [
        ...prev,
        { ref: "—", message: (err as Error).message || "Export failed" },
      ]);
    } finally {
      if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-magic-border bg-white p-5">
        <h3 className="font-semibold text-magic-ink mb-1">
          Export all quotations as PDF
        </h3>
        <p className="text-sm text-magic-ink/60 mb-4">
          Renders every quotation in the database to PDF on the client
          (hidden iframe + html2canvas + jsPDF) and bundles them into a
          single ZIP grouped by client folder. The output layout looks
          like <code className="text-xs bg-magic-soft px-1 rounded">
          &lt;Client folder&gt;/&lt;Ref&gt;.pdf</code>. Keep this tab in
          the foreground while the export runs — backgrounded tabs throttle
          the iframe and stall the render.
        </p>
        <button
          onClick={exportAll}
          disabled={running}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
        >
          {running ? "Exporting…" : "Export all quotations (ZIP)"}
        </button>
        {progress && progress.total > 0 && (
          <p className="mt-3 text-sm text-magic-ink/70">
            {progress.current} / {progress.total}
            {progress.label ? ` — ${progress.label}` : ""}
          </p>
        )}
        {errors.length > 0 && (
          <div className="mt-3 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
            <p className="font-semibold mb-1">
              {errors.length} quotation{errors.length === 1 ? "" : "s"} failed
              to render:
            </p>
            <ul className="list-disc ml-5 space-y-0.5 max-h-40 overflow-auto">
              {errors.map((e, i) => (
                <li key={i}>
                  <strong>{e.ref}</strong>: {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {done && errors.length === 0 && (
          <p className="mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            Export complete — your ZIP has been downloaded.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Resolve once the iframe's `load` event fires for the given URL, or
 * reject after 30 s — covering the case where the inner page hangs on a
 * slow Supabase round-trip. The iframe is reused across rows so we
 * always re-bind the handler before mutating `src`.
 */
function loadIframe(iframe: HTMLIFrameElement, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("iframe load timed out (30 s)")),
      30_000,
    );
    const cleanup = () => {
      window.clearTimeout(timer);
      iframe.onload = null;
      iframe.onerror = null;
    };
    iframe.onload = () => {
      cleanup();
      resolve();
    };
    iframe.onerror = () => {
      cleanup();
      reject(new Error("iframe load error"));
    };
    iframe.src = src;
  });
}

/**
 * Best-effort wait for the iframe's React tree, images and fonts to
 * settle so html2canvas captures a fully-painted document. We:
 *   1. wait a short tick for the QuotationViewer's mount-time fetch
 *      to populate state and re-render;
 *   2. wait for every <img> to fire `complete`;
 *   3. wait for `document.fonts.ready` when available;
 *   4. wait for at least one `.quotation-sheet` to appear (the
 *      viewer renders a loading skeleton first).
 */
async function waitForRender(iframe: HTMLIFrameElement): Promise<void> {
  const doc = iframe.contentDocument;
  if (!doc) return;
  // Wait for at least one .quotation-sheet to appear — the viewer
  // renders a loading skeleton first while it fetches the row.
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (doc.querySelector(".quotation-sheet")) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  // Image readiness
  const imgs = Array.from(doc.images);
  await Promise.all(
    imgs.map((img) =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const done = () => {
              img.removeEventListener("load", done);
              img.removeEventListener("error", done);
              resolve();
            };
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
          }),
    ),
  );
  // Font readiness (Chrome / Edge / modern Safari)
  try {
    const docWithFonts = doc as Document & {
      fonts?: { ready?: Promise<unknown> };
    };
    if (docWithFonts.fonts?.ready) {
      await docWithFonts.fonts.ready;
    }
  } catch {
    /* ignore — older browsers */
  }
  // Final settle frame so the last layout pass commits.
  await new Promise((r) => setTimeout(r, 500));
}

/**
 * Trim a string to a filesystem-safe ZIP path segment. We strip the
 * reserved characters Windows and POSIX disagree on, collapse
 * whitespace, and cap length so deeply-nested archives don't hit the
 * 260-character path limit on Windows when extracted.
 */
function sanitizePath(s: string): string {
  return (
    s
      .replace(/[\\/:*?"<>| -]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "untitled"
  );
}
