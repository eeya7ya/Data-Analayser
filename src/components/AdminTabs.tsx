"use client";

import { useRef, useState } from "react";
import JSZip from "jszip";
import UsersAndRolesPanel from "./UsersAndRolesPanel";
import AdminSettings from "./AdminSettings";
import BrandingAdmin from "./BrandingAdmin";
import FolderClassificationPanel from "./FolderClassificationPanel";
import NewsAdminPanel from "./NewsAdminPanel";
import EmailAdminPanel from "./EmailAdminPanel";
import type { AppSettings } from "@/lib/settings";

type Tab =
  | "users"
  | "folders"
  | "news"
  | "email"
  | "settings"
  | "branding"
  | "backups";

export default function AdminTabs({
  initialSettings,
  readOnly = false,
}: {
  initialSettings: AppSettings;
  /**
   * Viewer (`role = 'viewer'`) sees every tab but every mutating
   * control is disabled. Server still rejects writes via
   * `requireAdmin()` — `readOnly` is the UX mirror of that gate.
   */
  readOnly?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("users");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-magic-border">
        <TabButton active={tab === "users"} onClick={() => setTab("users")}>
          Users &amp; Roles
        </TabButton>
        <TabButton active={tab === "folders"} onClick={() => setTab("folders")}>
          Folders
        </TabButton>
        <TabButton active={tab === "news"} onClick={() => setTab("news")}>
          News
        </TabButton>
        <TabButton active={tab === "email"} onClick={() => setTab("email")}>
          Email
        </TabButton>
        <TabButton
          active={tab === "settings"}
          onClick={() => setTab("settings")}
        >
          Settings
        </TabButton>
        <TabButton
          active={tab === "branding"}
          onClick={() => setTab("branding")}
        >
          Branding
        </TabButton>
        <TabButton active={tab === "backups"} onClick={() => setTab("backups")}>
          Backups
        </TabButton>
      </div>

      {tab === "users" && (
        <section>
          <h2 className="text-lg font-semibold text-magic-ink mb-3">
            Users &amp; Roles
          </h2>
          <UsersAndRolesPanel readOnly={readOnly} />
        </section>
      )}

      {tab === "folders" && (
        <section>
          <h2 className="text-lg font-semibold text-magic-ink mb-3">
            Folder classification
          </h2>
          <FolderClassificationPanel />
        </section>
      )}

      {tab === "news" && (
        <section>
          <h2 className="text-lg font-semibold text-magic-ink mb-3">
            Dashboard announcements
          </h2>
          <NewsAdminPanel />
        </section>
      )}

      {tab === "email" && (
        <section>
          <h2 className="text-lg font-semibold text-magic-ink mb-3">
            Email — server &amp; user mailboxes
          </h2>
          <EmailAdminPanel />
        </section>
      )}

      {tab === "settings" && (
        <section>
          <h2 className="text-lg font-semibold text-magic-ink mb-3">
            Global presets
          </h2>
          <AdminSettings initialSettings={initialSettings} />
        </section>
      )}

      {tab === "branding" && (
        <section>
          <h2 className="text-lg font-semibold text-magic-ink mb-3">
            Branding — logos &amp; company profiles
          </h2>
          <BrandingAdmin initialSettings={initialSettings} readOnly={readOnly} />
        </section>
      )}

      {tab === "backups" && (
        <section className="space-y-6">
          <h2 className="text-lg font-semibold text-magic-ink mb-1">Backups</h2>
          <p className="text-sm text-magic-ink/60 -mt-1">
            Two backups cover everything the app holds: the{" "}
            <strong>files</strong> (PDFs, DWGs, …) and the{" "}
            <strong>database</strong> (clients, projects, quotations, …). Both
            are read-only and safe to run anytime.
          </p>
          <FilesBackupPanel />
          <DatabaseBackupPanel />
        </section>
      )}
    </div>
  );
}

type BackupFile = {
  id: number;
  folder: string;
  project: string;
  kind: string;
  filename: string;
  zipPath: string;
  sizeBytes: number;
  url: string;
};

type QuotationIndexEntry = {
  id: number;
  ref: string;
  folder: string;
  project: string;
};

type PricingLine = {
  position: number;
  itemModel: string;
  priceUsd: string;
  quantity: number;
  shippingOverride: string | null;
  customsOverride: string | null;
  shippingRateOverride: string | null;
  customsRateOverride: string | null;
  profitRateOverride: string | null;
};
type PricingConstants = {
  currencyRate: string;
  shippingRate: string;
  customsRate: string;
  profitMargin: string;
  taxRate: string;
  targetCurrency: string;
  sourceCurrency: string;
};
type PricingProject = {
  id: number;
  name: string;
  date: string | null;
  responsiblePerson: string | null;
  createdAt: string;
  constants: PricingConstants | null;
  productLines: PricingLine[];
};
type PricingManufacturer = {
  id: number;
  name: string;
  projects: PricingProject[];
};

type FilesManifest = {
  ok: boolean;
  error?: string;
  generatedAt: string;
  count: number;
  totalBytes: number;
  files: BackupFile[];
  quotations: QuotationIndexEntry[];
  pricing: { manufacturers: PricingManufacturer[] };
};

/**
 * Download a complete backup of everything the app produces, laid out in the
 * same Client → Project structure as the app, assembled in the browser:
 *
 *   1. Uploaded files (PDFs, DWGs, …) pulled straight from Cloudflare R2 →
 *      <Client>/<Project>/<Kind>/<filename>, original bytes.
 *   2. Designed quotations rendered to PDF (hidden iframe → html2canvas →
 *      jsPDF) → <Client>/<Project>/Quotations/<Ref>.pdf.
 *   3. The pricing module written to one .xlsx per manufacturer → Pricing/.
 *
 * Everything is zipped client-side, so no file bytes ever transit our server
 * (which is what made the old all-in-one server ZIP fail with net::ERR_FAILED).
 */
function FilesBackupPanel() {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  async function downloadFilesBackup() {
    setExporting(true);
    setMsg(null);
    setProgress("Listing everything to back up…");
    let iframe: HTMLIFrameElement | null = null;
    try {
      const res = await fetch("/api/admin/files-backup", { method: "GET" });
      const data = (await res.json().catch(() => ({}))) as FilesManifest;
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const zip = new JSZip();
      const manifest: Array<Record<string, unknown>> = [];

      // ── 1. Uploaded files (original bytes from R2) ───────────────────────
      let embedded = 0;
      let bytes = 0;
      let corsBlocked = 0;
      for (let i = 0; i < data.files.length; i++) {
        const f = data.files[i];
        setProgress(
          `Downloading files from Cloudflare R2… ${i + 1} of ${data.files.length}`,
        );
        const meta = {
          kind: "uploaded-file",
          id: f.id,
          folder: f.folder,
          project: f.project,
          fileKind: f.kind,
          filename: f.filename,
          zipPath: f.zipPath,
        };
        try {
          const r = await fetch(f.url);
          if (!r.ok) throw new Error(`R2 responded ${r.status}`);
          const buf = await r.arrayBuffer();
          zip.file(f.zipPath, buf);
          embedded++;
          bytes += buf.byteLength;
          manifest.push({ ...meta, embedded: true, bytes: buf.byteLength });
        } catch (err) {
          // A cross-origin block surfaces as a TypeError "Failed to fetch"
          // with no status — almost always R2 CORS not allowing GET.
          if (err instanceof TypeError) corsBlocked++;
          manifest.push({
            ...meta,
            embedded: false,
            error: (err as Error).message,
          });
        }
      }
      if (data.files.length > 0 && embedded === 0 && corsBlocked > 0) {
        throw new Error(
          "The browser was blocked from reading files out of Cloudflare R2 " +
            "(CORS). Add your app's origin with the GET method to the R2 " +
            "bucket's CORS policy (R2 → bucket → Settings → CORS Policy), then " +
            "try again. See .env.example for the exact policy.",
        );
      }

      // ── 2. Designed quotations → PDF ─────────────────────────────────────
      const quotations = data.quotations ?? [];
      let quotePdfs = 0;
      if (quotations.length > 0) {
        const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
          import("jspdf"),
          import("html2canvas"),
        ]);
        iframe = createHiddenIframe();
        for (let i = 0; i < quotations.length; i++) {
          const qn = quotations[i];
          setProgress(
            `Rendering designed quotations to PDF… ${i + 1} of ${quotations.length}` +
              (qn.ref ? ` (${qn.ref})` : ""),
          );
          const dir = `${safeSeg(qn.folder)}/${safeSeg(qn.project)}/Quotations`;
          const zipPath = uniqueZipPath(
            zip,
            `${dir}/${safeSeg(qn.ref || `quotation-${qn.id}`)}.pdf`,
          );
          try {
            const pdfBlob = await renderQuotationPdf(
              iframe,
              qn.id,
              jsPDF,
              html2canvas,
            );
            zip.file(zipPath, pdfBlob);
            quotePdfs++;
            manifest.push({
              kind: "designed-quotation",
              id: qn.id,
              ref: qn.ref,
              folder: qn.folder,
              project: qn.project,
              zipPath,
              embedded: true,
            });
          } catch (err) {
            manifest.push({
              kind: "designed-quotation",
              id: qn.id,
              ref: qn.ref,
              embedded: false,
              error: (err as Error).message,
            });
          }
        }
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        iframe = null;
      }

      // ── 3. Pricing module → one .xlsx per manufacturer ───────────────────
      const manufacturers = data.pricing?.manufacturers ?? [];
      let pricingFiles = 0;
      const manufacturersWithData = manufacturers.filter(
        (m) => m.projects.length > 0,
      );
      if (manufacturersWithData.length > 0) {
        setProgress("Building pricing workbooks…");
        const XLSX = await import("xlsx");
        const usedNames = new Set<string>();
        for (const m of manufacturersWithData) {
          let name = safeSeg(m.name || `manufacturer-${m.id}`);
          while (usedNames.has(name.toLowerCase())) name = `${name} (${m.id})`;
          usedNames.add(name.toLowerCase());
          const buf = buildPricingWorkbook(XLSX, m);
          zip.file(`Pricing/${name}.xlsx`, buf);
          pricingFiles++;
          manifest.push({
            kind: "pricing-workbook",
            manufacturer: m.name,
            projects: m.projects.length,
            zipPath: `Pricing/${name}.xlsx`,
            embedded: true,
          });
        }
      }

      // ── Manifest + README ────────────────────────────────────────────────
      const failedFiles = data.files.length - embedded;
      zip.file("_manifest.json", JSON.stringify(manifest, null, 2));
      zip.file(
        "README.txt",
        [
          "MagicTech — Full Backup",
          "=======================",
          `Generated: ${data.generatedAt}`,
          "",
          "Layout",
          "------",
          "  <Client>/<Project>/<Kind>/<file>        uploaded files (original)",
          "  <Client>/<Project>/Quotations/<Ref>.pdf designed quotations (PDF)",
          "  Pricing/<Manufacturer>.xlsx             pricing module (Excel)",
          "",
          "Kind folders (Quotations, Purchase Orders, BOQs, Other) mirror the",
          "tabs in each project's Files panel.",
          "",
          "Contents",
          "--------",
          `  Uploaded files:      ${embedded} (${(bytes / (1024 * 1024)).toFixed(2)} MB)` +
            (failedFiles ? `, ${failedFiles} unreadable (see _manifest.json)` : ""),
          `  Quotation PDFs:      ${quotePdfs} of ${quotations.length}`,
          `  Pricing workbooks:   ${pricingFiles}`,
          "",
          "_manifest.json lists every item with its source and any errors.",
        ].join("\n"),
      );

      setProgress("Building ZIP…");
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      const stamp = data.generatedAt.replace(/[:.]/g, "-");
      const filename = `magictech-full-backup-${stamp}.zip`;
      triggerDownload(blob, filename);

      const mb = (blob.size / (1024 * 1024)).toFixed(2);
      setMsg({
        kind: "ok",
        text:
          `Backup downloaded: ${filename} (${mb} MB). ` +
          `${embedded} file(s), ${quotePdfs} quotation PDF(s), ${pricingFiles} pricing workbook(s).` +
          (failedFiles
            ? ` ${failedFiles} file(s) couldn't be read — see _manifest.json.`
            : ""),
      });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      setExporting(false);
      setProgress(null);
    }
  }

  return (
    <div className="rounded-xl border-2 border-magic-red/40 bg-white p-5">
      <h3 className="font-semibold text-magic-ink mb-1">Files backup</h3>
      <p className="text-sm text-magic-ink/60 mb-4">
        Bundles <strong>everything the app produces</strong> into one ZIP,
        organised exactly like the app (<code>Client / Project / …</code>):
        every <strong>uploaded file</strong> (PDFs, DWGs, Excel, photos) in its
        original format; every <strong>designed quotation</strong> rendered to{" "}
        <strong>PDF</strong> under each project's <code>Quotations</code> folder;
        and the whole <strong>pricing module</strong> as one{" "}
        <strong>Excel workbook per manufacturer</strong> under{" "}
        <code>Pricing/</code>. It's assembled in your browser, so keep this tab
        in front while it runs.
      </p>
      <div className="space-y-2 md:max-w-lg">
        <button
          onClick={downloadFilesBackup}
          disabled={exporting}
          className="w-full px-4 py-2 text-sm font-semibold rounded-lg bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
        >
          {exporting ? "Preparing backup…" : "Download files backup (.zip)"}
        </button>
        {progress && (
          <p className="text-sm text-magic-ink/70 bg-magic-soft border border-magic-border rounded-lg px-3 py-2">
            {progress}
          </p>
        )}
        <p className="text-xs text-magic-ink/50">
          Layout: <code>&lt;Client&gt;/&lt;Project&gt;/&lt;Kind&gt;/&lt;file&gt;</code>,{" "}
          <code>&lt;Client&gt;/&lt;Project&gt;/Quotations/&lt;Ref&gt;.pdf</code>,{" "}
          <code>Pricing/&lt;Manufacturer&gt;.xlsx</code>, plus{" "}
          <code>_manifest.json</code> and <code>README.txt</code>. Uploaded
          files come straight from Cloudflare R2 — nothing is read from Supabase.
        </p>
        {msg && (
          <p
            className={`mt-2 text-sm rounded-lg px-3 py-2 ${
              msg.kind === "ok"
                ? "text-green-700 bg-green-50 border border-green-200"
                : "text-red-700 bg-red-50 border border-red-200"
            }`}
          >
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}

type RestoreReport = {
  ok: boolean;
  error?: string;
  backupTakenAt?: string;
  totals?: { inserted?: number; updated?: number; skipped?: number };
  tables?: Array<{
    name?: string;
    table?: string;
    rowsBefore?: number;
    rowsAfter?: number;
    upserts?: number;
    error?: string;
  }>;
};

/**
 * Download a restore-ready snapshot of every database table, and restore one
 * back. Server routes: GET /api/admin/db-backup and
 * POST /api/admin/backup/restore. The restore is additive — it upserts every
 * row by primary key and never deletes.
 */
function DatabaseBackupPanel() {
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreReport, setRestoreReport] = useState<RestoreReport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function downloadDbBackup() {
    setExporting(true);
    setExportMsg(null);
    try {
      const res = await fetch("/api/admin/db-backup", { method: "GET" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const filename =
        filenameFromResponse(res) ||
        `magictech-database-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
      triggerDownload(blob, filename);
      const mb = (blob.size / (1024 * 1024)).toFixed(2);
      setExportMsg({
        kind: "ok",
        text: `Database backup downloaded: ${filename} (${mb} MB). Keep at least one copy off this server.`,
      });
    } catch (err) {
      setExportMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setExporting(false);
    }
  }

  async function uploadBackup(file: File) {
    const confirmed = window.confirm(
      `Restore from "${file.name}"?\n\n` +
        "Every row in the backup will be upserted by primary key into the " +
        "current database:\n" +
        "  • matching rows are OVERWRITTEN with backup values\n" +
        "  • missing rows are INSERTED\n" +
        "  • extra rows already in this DB are LEFT ALONE (nothing deleted)\n\n" +
        "Take a fresh database backup first if you're unsure. Continue?",
    );
    if (!confirmed) return;
    setRestoring(true);
    setRestoreReport(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/backup/restore", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as RestoreReport;
      setRestoreReport(data);
    } catch (err) {
      setRestoreReport({ ok: false, error: (err as Error).message });
    } finally {
      setRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="rounded-xl border-2 border-magic-red/40 bg-white p-5">
      <h3 className="font-semibold text-magic-ink mb-1">Database backup</h3>
      <p className="text-sm text-magic-ink/60 mb-4">
        Downloads a <strong>complete snapshot of every table</strong> —
        clients, projects, quotations, leads, pricing sheets, users and
        settings — as one restore-ready ZIP (lossless JSON per table, with a
        manifest and content hashes). This is the <strong>data</strong>; the
        uploaded file blobs live in the separate Files backup above. Use{" "}
        <em>Restore</em> to load a snapshot back into any database — it upserts
        every row by primary key and never deletes.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <button
            onClick={downloadDbBackup}
            disabled={exporting}
            className="w-full px-4 py-2 text-sm font-semibold rounded-lg bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
          >
            {exporting
              ? "Preparing database backup…"
              : "Download database backup (.zip)"}
          </button>
          <p className="text-xs text-magic-ink/50">
            Contains <code>manifest.json</code>,{" "}
            <code>data/&lt;table&gt;.json</code> and a combined{" "}
            <code>all.json</code>.
          </p>
          {exportMsg && (
            <p
              className={`mt-2 text-sm rounded-lg px-3 py-2 ${
                exportMsg.kind === "ok"
                  ? "text-green-700 bg-green-50 border border-green-200"
                  : "text-red-700 bg-red-50 border border-red-200"
              }`}
            >
              {exportMsg.text}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label
            className={`block w-full text-center px-4 py-2 text-sm font-medium rounded-lg border border-magic-red text-magic-red bg-white hover:bg-magic-red/5 cursor-pointer transition-colors ${
              restoring ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            {restoring ? "Restoring…" : "Restore from backup (.zip)"}
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadBackup(f);
              }}
            />
          </label>
          <p className="text-xs text-magic-ink/50">
            Upserts every row by primary key. Existing rows in the destination
            that are <em>not</em> in the backup are kept untouched.
          </p>
          {restoreReport && (
            <div
              className={`mt-2 text-sm rounded-lg px-3 py-2 ${
                restoreReport.ok
                  ? "text-green-700 bg-green-50 border border-green-200"
                  : "text-red-700 bg-red-50 border border-red-200"
              }`}
            >
              {restoreReport.ok ? (
                <>
                  <div>
                    Restore complete. From backup of{" "}
                    <strong>
                      {restoreReport.backupTakenAt &&
                        new Date(restoreReport.backupTakenAt).toLocaleString()}
                    </strong>
                    .
                  </div>
                  <div className="mt-1">
                    Inserted {restoreReport.totals?.inserted ?? 0}, updated{" "}
                    {restoreReport.totals?.updated ?? 0}, skipped{" "}
                    {restoreReport.totals?.skipped ?? 0}.
                  </div>
                  {restoreReport.tables &&
                    restoreReport.tables.some((t) => t.error) && (
                      <ul className="mt-2 list-disc pl-5">
                        {restoreReport.tables
                          .filter((t) => t.error)
                          .map((t) => (
                            <li key={t.table} className="text-red-700">
                              {t.table}: {t.error}
                            </li>
                          ))}
                      </ul>
                    )}
                </>
              ) : (
                <>Error: {restoreReport.error}</>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Pull the server-suggested filename out of a Content-Disposition header. */
function filenameFromResponse(res: Response): string | null {
  const cd = res.headers.get("content-disposition") || "";
  const match = cd.match(/filename="?([^";]+)"?/i);
  return match ? match[1] : null;
}

/** Save a blob to disk via a transient anchor. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Path-segment sanitiser that MIRRORS the server's safeSegment (in
 * src/app/api/admin/files-backup/route.ts) exactly, so quotation PDFs and
 * pricing files nest into the same <Client>/<Project> folders as the
 * server-computed uploaded-file paths.
 */
function safeSeg(raw: string): string {
  const cleaned = String(raw || "")
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120);
  return cleaned || "Unnamed";
}

/** Return a zip path that isn't already taken, suffixing " (n)" if needed. */
function uniqueZipPath(zip: JSZip, path: string): string {
  if (!zip.file(path)) return path;
  const dot = path.lastIndexOf(".");
  const base = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : "";
  let n = 2;
  while (zip.file(`${base} (${n})${ext}`)) n++;
  return `${base} (${n})${ext}`;
}

/** A 900×1400 off-screen iframe used to render quotation sheets for capture. */
function createHiddenIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.border = "0";
  iframe.style.width = "900px";
  iframe.style.height = "1400px";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);
  return iframe;
}

/**
 * Render one designed quotation to a multi-page A4 PDF by loading its
 * read-only printable view (`/quotation?id=<n>`) in the hidden iframe and
 * snapshotting each `.quotation-sheet` with html2canvas.
 */
async function renderQuotationPdf(
  iframe: HTMLIFrameElement,
  id: number,
  JsPDF: typeof import("jspdf").jsPDF,
  html2canvas: typeof import("html2canvas").default,
): Promise<Blob> {
  // `view=1` forces the standalone read-only viewer to render inline instead
  // of redirecting into the CRM drill-down, so the iframe lands directly on a
  // page that paints `.quotation-sheet`.
  await loadIframe(iframe, `/quotation?id=${id}&view=1`);
  await waitForRender(iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("iframe document unreachable");
  const sheets = Array.from(
    doc.querySelectorAll(".quotation-sheet"),
  ) as HTMLElement[];
  if (sheets.length === 0) throw new Error("no rendered sheets");
  const pdf = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  for (let s = 0; s < sheets.length; s++) {
    const canvas = await html2canvas(sheets[s], {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      windowWidth: iframe.contentWindow?.innerWidth || 900,
      windowHeight: iframe.contentWindow?.innerHeight || 1400,
    });
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    if (s > 0) pdf.addPage();
    pdf.addImage(imgData, "JPEG", 0, 0, 210, 297);
  }
  return pdf.output("blob");
}

/** Resolve when the iframe finishes loading `src`, or reject after 30 s. */
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

/** Wait for the quotation viewer's tree, images and fonts to settle. */
async function waitForRender(iframe: HTMLIFrameElement): Promise<void> {
  const doc = iframe.contentDocument;
  if (!doc) return;
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (doc.querySelector(".quotation-sheet")) break;
    await new Promise((r) => setTimeout(r, 200));
  }
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
  try {
    const docWithFonts = doc as Document & {
      fonts?: { ready?: Promise<unknown> };
    };
    if (docWithFonts.fonts?.ready) await docWithFonts.fonts.ready;
  } catch {
    /* older browsers */
  }
  await new Promise((r) => setTimeout(r, 500));
}

/** Build one .xlsx (Projects + Product Lines sheets) for a manufacturer. */
function buildPricingWorkbook(
  XLSX: typeof import("xlsx"),
  m: PricingManufacturer,
): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const projectRows = m.projects.map((p) => ({
    Project: p.name,
    Date: p.date ?? "",
    Responsible: p.responsiblePerson ?? "",
    "Created At": p.createdAt,
    "Currency Rate": p.constants?.currencyRate ?? "",
    "Shipping Rate": p.constants?.shippingRate ?? "",
    "Customs Rate": p.constants?.customsRate ?? "",
    "Profit Margin": p.constants?.profitMargin ?? "",
    "Tax Rate": p.constants?.taxRate ?? "",
    "Target Currency": p.constants?.targetCurrency ?? "",
    "Source Currency": p.constants?.sourceCurrency ?? "",
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      projectRows.length ? projectRows : [{ Project: "(no projects)" }],
    ),
    "Projects",
  );

  const lineRows: Array<Record<string, unknown>> = [];
  for (const p of m.projects) {
    for (const l of p.productLines) {
      lineRows.push({
        Project: p.name,
        Position: l.position,
        "Item / Model": l.itemModel,
        "Price USD": l.priceUsd,
        Quantity: l.quantity,
        "Shipping Override": l.shippingOverride ?? "",
        "Customs Override": l.customsOverride ?? "",
        "Shipping Rate Override": l.shippingRateOverride ?? "",
        "Customs Rate Override": l.customsRateOverride ?? "",
        "Profit Rate Override": l.profitRateOverride ?? "",
      });
    }
  }
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      lineRows.length ? lineRows : [{ Project: "(no product lines)" }],
    ),
    "Product Lines",
  );

  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
        active
          ? "border-magic-red text-magic-red"
          : "border-transparent text-magic-ink/60 hover:text-magic-ink"
      }`}
    >
      {children}
    </button>
  );
}
