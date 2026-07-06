"use client";

import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import {
  Database,
  Cloud,
  Package,
  Download,
  Upload,
  Globe,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Check,
  type LucideIcon,
} from "lucide-react";
import UsersAndRolesPanel from "./UsersAndRolesPanel";
import AdminSettings from "./AdminSettings";
import BrandingAdmin from "./BrandingAdmin";
import TechProposalAssetsAdmin from "./TechProposalAssetsAdmin";
import NewsAdminPanel from "./NewsAdminPanel";
import EmailAdminPanel from "./EmailAdminPanel";
import SyslogPanel from "./SyslogPanel";
import type { AppSettings } from "@/lib/settings";

type Tab =
  | "users"
  | "news"
  | "email"
  | "settings"
  | "branding"
  | "proposal"
  | "backups"
  | "syslog";

const TABS: Tab[] = [
  "users",
  "news",
  "email",
  "settings",
  "branding",
  "backups",
  "syslog",
];

export default function AdminTabs({
  initialSettings,
  readOnly = false,
  initialTab,
}: {
  initialSettings: AppSettings;
  /**
   * Viewer (`role = 'viewer'`) sees every tab but every mutating
   * control is disabled. Server still rejects writes via
   * `requireAdmin()` — `readOnly` is the UX mirror of that gate.
   */
  readOnly?: boolean;
  /** Tab to open on mount (e.g. from `/admin?tab=clients`). */
  initialTab?: string;
}) {
  const [tab, setTab] = useState<Tab>(
    (TABS as string[]).includes(initialTab ?? "")
      ? (initialTab as Tab)
      : "users",
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-magic-border overflow-x-auto">
        <TabButton active={tab === "users"} onClick={() => setTab("users")}>
          Users &amp; Roles
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
        <TabButton
          active={tab === "proposal"}
          onClick={() => setTab("proposal")}
        >
          Technical Proposal
        </TabButton>
        <TabButton active={tab === "backups"} onClick={() => setTab("backups")}>
          Backups
        </TabButton>
        <TabButton active={tab === "syslog"} onClick={() => setTab("syslog")}>
          Syslog
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

      {tab === "proposal" && (
        <TechProposalAssetsAdmin
          initialSettings={initialSettings}
          readOnly={readOnly}
        />
      )}

      {tab === "backups" && <BackupsSection />}

      {tab === "syslog" && (
        <section>
          <h2 className="text-lg font-semibold text-magic-ink mb-3">
            Syslog — click activity
          </h2>
          <SyslogPanel readOnly={readOnly} />
        </section>
      )}
    </div>
  );
}

// ─── Backups section (Backup / Restore sub-tabs) ─────────────────────────────

function BackupsSection() {
  const [view, setView] = useState<"backup" | "restore">("backup");
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-magic-ink">Backups</h2>
        <p className="mt-1 max-w-3xl text-sm text-magic-ink/60">
          Everything the app holds, covered both ways. <strong>Back up</strong>{" "}
          the database, the R2 files, or one complete archive — then{" "}
          <strong>restore</strong> any of them, so you can recover whether you
          replace the database, lose your files, or lose the whole bucket.
        </p>
      </div>

      <div className="inline-flex rounded-xl border border-magic-border bg-magic-soft p-1">
        <SubTabButton
          active={view === "backup"}
          onClick={() => setView("backup")}
        >
          <Download className="h-4 w-4" />
          Backup
        </SubTabButton>
        <SubTabButton
          active={view === "restore"}
          onClick={() => setView("restore")}
        >
          <Upload className="h-4 w-4" />
          Restore
        </SubTabButton>
      </div>

      {view === "backup" ? (
        <>
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>
              Read-only &amp; safe — nothing here modifies your data. Backups are
              assembled in your browser straight from Cloudflare, so keep this
              tab open while a download runs.
            </span>
          </div>
          <div className="grid gap-4">
            <DatabaseBackupPanel />
            <R2FilesBackupPanel />
            <CompleteAppBackupPanel />
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Restoring <strong>writes data</strong>. Every restore is additive
              (it upserts and never deletes), but take a fresh backup first if
              you&apos;re unsure. Keep this tab open while a restore runs.
            </span>
          </div>
          <div className="grid gap-4">
            <RestoreDatabasePanel />
            <RestoreFilesPanel />
            <OffsiteBackupPanel />
          </div>
        </>
      )}
    </section>
  );
}

function SubTabButton({
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
      className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
        active
          ? "bg-white text-magic-ink shadow-sm"
          : "text-magic-ink/55 hover:text-magic-ink"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Shared types ────────────────────────────────────────────────────────────

type BackupFile = {
  id: number;
  folder: string;
  project: string;
  kind: string;
  filename: string;
  mime: string;
  zipPath: string;
  /** R2 key suffix (project-files/<storagePath>) — lets a restore re-upload
   *  each blob to its exact original key. */
  storagePath: string;
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

type Msg = { kind: "ok" | "error"; text: string };

// ─── Backup 1: entire database ───────────────────────────────────────────────

/**
 * Download the entire database as one restore-ready ZIP. The server
 * (`GET /api/admin/db-backup`) introspects every table, dumps each one to
 * lossless JSON and packages it with a manifest + per-table content hashes.
 * This is the DATA — clients, projects, quotations, leads, pricing, users and
 * settings. Read-only; nothing in the database is changed.
 *
 * DB-agnostic: the snapshot + restore work the same whether the store is
 * Postgres (Supabase) or Cloudflare D1/SQLite — the introspection branches on
 * the active engine, so the download and its restore never depend on which
 * database type is live.
 */
function DatabaseBackupPanel() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  async function download() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/db-backup", { method: "GET" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const filename =
        filenameFromResponse(res) ||
        `magictech-database-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
      triggerDownload(blob, filename);
      const mb = (blob.size / (1024 * 1024)).toFixed(2);
      setMsg({
        kind: "ok",
        text: `Database downloaded: ${filename} (${mb} MB). Keep at least one copy off this server.`,
      });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <BackupCard
      icon={Database}
      accent="indigo"
      title="Database"
      description="A complete, restore-ready snapshot of every table in the database (Postgres or D1)."
      included={[
        "Every row of every table — clients, projects, quotations, leads, pricing, users, settings",
        "Lossless JSON per table with a manifest and content hashes",
        "Restorable into any database type — Postgres or D1/SQLite",
      ]}
    >
      <ActionButton accent="indigo" busy={busy} onClick={download}>
        {busy ? "Preparing database…" : "Download database (.zip)"}
      </ActionButton>
      <ResultMessage msg={msg} />
    </BackupCard>
  );
}

// ─── Backup 2: R2 files ──────────────────────────────────────────────────────

/**
 * Download every uploaded file out of Cloudflare R2 as one ZIP, organised the
 * same way as the app (`<Client>/<Project>/<Kind>/<file>`). The server returns
 * only a manifest of presigned R2 URLs; the browser pulls each file's original
 * bytes straight from R2 and zips them locally, so no file ever transits our
 * server (which is what caps the all-in-one server ZIP).
 */
function R2FilesBackupPanel() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);

  async function download() {
    setBusy(true);
    setMsg(null);
    setProgress("Listing every file in R2…");
    try {
      const data = await fetchFilesManifest();

      const zip = new JSZip();
      const manifest: Array<Record<string, unknown>> = [];
      const { embedded, bytes, corsBlocked } = await addR2FilesToZip(
        zip,
        data.files,
        manifest,
        setProgress,
      );
      assertNotCorsBlocked(data.files.length, embedded, corsBlocked);

      const failed = data.files.length - embedded;
      zip.file("_manifest.json", JSON.stringify(manifest, null, 2));
      zip.file(
        "README.txt",
        [
          "MagicTech — R2 Files Backup",
          "===========================",
          `Generated: ${data.generatedAt}`,
          "",
          "Layout",
          "------",
          "  <Client>/<Project>/<Kind>/<file>   every uploaded file, original bytes",
          "",
          "These are the exact files stored in Cloudflare R2 (PDFs, DWGs, Excel,",
          "photos). Kind folders (Quotations, Purchase Orders, BOQs, Other) mirror",
          "the tabs in each project's Files panel.",
          "",
          "Contents",
          "--------",
          `  Files: ${embedded} (${(bytes / (1024 * 1024)).toFixed(2)} MB)` +
            (failed ? `, ${failed} unreadable (see _manifest.json)` : ""),
          "",
          "_manifest.json lists every item with its source and any errors.",
        ].join("\n"),
      );

      if (data.files.length === 0) {
        setMsg({
          kind: "ok",
          text: "No uploaded files to back up yet — R2 is empty.",
        });
        return;
      }

      setProgress("Building ZIP…");
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      const stamp = data.generatedAt.replace(/[:.]/g, "-");
      const filename = `magictech-r2-files-${stamp}.zip`;
      triggerDownload(blob, filename);

      const mb = (blob.size / (1024 * 1024)).toFixed(2);
      setMsg({
        kind: "ok",
        text:
          `R2 files downloaded: ${filename} (${mb} MB). ${embedded} file(s).` +
          (failed
            ? ` ${failed} file(s) couldn't be read — see _manifest.json.`
            : ""),
      });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <BackupCard
      icon={Cloud}
      accent="cyan"
      title="R2 storage"
      description="Every uploaded file in Cloudflare R2, in its original format, bundled into one ZIP."
      included={[
        "Every uploaded file — PDFs, DWGs, Excel, photos — byte-for-byte",
        "Organised as Client / Project / Kind / file, just like the app",
        "Streamed straight from R2 in your browser, never through the server",
      ]}
    >
      <ActionButton accent="cyan" busy={busy} onClick={download}>
        {busy ? "Preparing files…" : "Download R2 files (.zip)"}
      </ActionButton>
      <ProgressMessage progress={progress} />
      <ResultMessage msg={msg} />
    </BackupCard>
  );
}

// ─── Backup 3: complete app archive ──────────────────────────────────────────

/**
 * Download ONE archive that contains everything the app holds: the entire D1
 * database (nested as a restore-ready ZIP), every uploaded file from R2, every
 * designed quotation rendered to PDF, and the whole pricing module as one Excel
 * workbook per manufacturer. Assembled in the browser from
 * `/api/admin/files-backup` (files + quotations + pricing) and
 * `/api/admin/db-backup` (the database snapshot).
 */
function CompleteAppBackupPanel() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);

  async function download() {
    setBusy(true);
    setMsg(null);
    setProgress("Listing everything to back up…");
    let iframe: HTMLIFrameElement | null = null;
    try {
      const data = await fetchFilesManifest();

      const zip = new JSZip();
      const manifest: Array<Record<string, unknown>> = [];

      // 1. The entire D1 database, nested as its own restore-ready ZIP.
      setProgress("Adding the D1 database snapshot…");
      let dbIncluded = false;
      let dbError: string | null = null;
      try {
        const dbRes = await fetch("/api/admin/db-backup", { method: "GET" });
        if (!dbRes.ok) {
          const body = await dbRes.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${dbRes.status}`);
        }
        const dbBuf = await dbRes.arrayBuffer();
        zip.file("Database/d1-database-backup.zip", dbBuf);
        dbIncluded = true;
        manifest.push({
          kind: "d1-database",
          zipPath: "Database/d1-database-backup.zip",
          embedded: true,
          bytes: dbBuf.byteLength,
        });
      } catch (err) {
        dbError = (err as Error).message;
        manifest.push({ kind: "d1-database", embedded: false, error: dbError });
      }

      // 2. Uploaded files (original bytes from R2).
      const { embedded, bytes, corsBlocked } = await addR2FilesToZip(
        zip,
        data.files,
        manifest,
        setProgress,
      );
      assertNotCorsBlocked(data.files.length, embedded, corsBlocked);

      // 3. Designed quotations → PDF.
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

      // 4. Pricing module → one .xlsx per manufacturer.
      const manufacturers = data.pricing?.manufacturers ?? [];
      const manufacturersWithData = manufacturers.filter(
        (m) => m.projects.length > 0,
      );
      let pricingFiles = 0;
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

      // Manifest + README.
      const failedFiles = data.files.length - embedded;
      zip.file("_manifest.json", JSON.stringify(manifest, null, 2));
      zip.file(
        "README.txt",
        [
          "MagicTech — Complete App Backup",
          "===============================",
          `Generated: ${data.generatedAt}`,
          "",
          "This single archive contains EVERYTHING the app holds.",
          "",
          "Layout",
          "------",
          "  Database/d1-database-backup.zip          the entire D1 database (restore-ready)",
          "  <Client>/<Project>/<Kind>/<file>         uploaded files (original)",
          "  <Client>/<Project>/Quotations/<Ref>.pdf  designed quotations (PDF)",
          "  Pricing/<Manufacturer>.xlsx              pricing module (Excel)",
          "",
          "Contents",
          "--------",
          `  D1 database:        ${dbIncluded ? "included" : `NOT included — ${dbError}`}`,
          `  Uploaded files:     ${embedded} (${(bytes / (1024 * 1024)).toFixed(2)} MB)` +
            (failedFiles ? `, ${failedFiles} unreadable (see _manifest.json)` : ""),
          `  Quotation PDFs:     ${quotePdfs} of ${quotations.length}`,
          `  Pricing workbooks:  ${pricingFiles}`,
          "",
          "Database/d1-database-backup.zip is itself a restore-ready snapshot.",
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
      const filename = `magictech-complete-backup-${stamp}.zip`;
      triggerDownload(blob, filename);

      const mb = (blob.size / (1024 * 1024)).toFixed(2);
      setMsg({
        kind: dbIncluded ? "ok" : "error",
        text:
          `Complete backup downloaded: ${filename} (${mb} MB). ` +
          `Database ${dbIncluded ? "included" : "MISSING"}, ${embedded} file(s), ` +
          `${quotePdfs} quotation PDF(s), ${pricingFiles} pricing workbook(s).` +
          (failedFiles
            ? ` ${failedFiles} file(s) couldn't be read — see _manifest.json.`
            : "") +
          (dbIncluded ? "" : ` Database error: ${dbError}`),
      });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <BackupCard
      icon={Package}
      accent="red"
      title="Complete app archive"
      description="One ZIP with everything — the database, all R2 files, your designed quotations and the pricing module."
      badge="Everything"
      included={[
        "The entire database, nested as a restore-ready snapshot",
        "Every uploaded file from R2 in its original format",
        "Every designed quotation rendered to PDF",
        "The whole pricing module as one Excel workbook per manufacturer",
      ]}
    >
      <ActionButton accent="red" busy={busy} onClick={download}>
        {busy ? "Preparing complete backup…" : "Download complete backup (.zip)"}
      </ActionButton>
      <ProgressMessage progress={progress} />
      <ResultMessage msg={msg} />
    </BackupCard>
  );
}

// ─── Shared backup logic ─────────────────────────────────────────────────────

/** Fetch the files-backup manifest (files + quotations + pricing), or throw. */
async function fetchFilesManifest(): Promise<FilesManifest> {
  const res = await fetch("/api/admin/files-backup", { method: "GET" });
  const data = (await res.json().catch(() => ({}))) as FilesManifest;
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

/**
 * Download every uploaded file from R2 into `zip` at its computed path, pushing
 * one manifest entry per file. Returns counts so the caller can build a README
 * and detect a total CORS block.
 */
async function addR2FilesToZip(
  zip: JSZip,
  files: BackupFile[],
  manifest: Array<Record<string, unknown>>,
  onProgress: (text: string) => void,
): Promise<{ embedded: number; bytes: number; corsBlocked: number }> {
  let embedded = 0;
  let bytes = 0;
  let corsBlocked = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(
      `Downloading files from Cloudflare R2… ${i + 1} of ${files.length}`,
    );
    const meta = {
      kind: "uploaded-file",
      id: f.id,
      folder: f.folder,
      project: f.project,
      fileKind: f.kind,
      filename: f.filename,
      // storagePath + mime are what a files-restore needs to put each blob
      // back at its exact R2 key with the right content type.
      storagePath: f.storagePath,
      mime: f.mime,
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
      // A cross-origin block surfaces as a TypeError "Failed to fetch" with no
      // status — almost always R2 CORS not allowing GET.
      if (err instanceof TypeError) corsBlocked++;
      manifest.push({ ...meta, embedded: false, error: (err as Error).message });
    }
  }
  return { embedded, bytes, corsBlocked };
}

/**
 * Throw a clear, actionable error when every R2 download failed with a CORS
 * block, so the user knows to fix the bucket's CORS policy rather than chasing
 * a vague "failed to fetch".
 */
function assertNotCorsBlocked(
  total: number,
  embedded: number,
  corsBlocked: number,
): void {
  if (total > 0 && embedded === 0 && corsBlocked > 0) {
    throw new Error(
      "The browser was blocked from reading files out of Cloudflare R2 " +
        "(CORS). Add your app's origin with the GET method to the R2 bucket's " +
        "CORS policy (R2 → bucket → Settings → CORS Policy), then try again. " +
        "See .env.example for the exact policy.",
    );
  }
}

// ─── Restore: database ───────────────────────────────────────────────────────

type RestoreReport = {
  ok: boolean;
  error?: string;
  backupTakenAt?: string;
  totals?: { inserted?: number; updated?: number; skipped?: number };
  tables?: Array<{ table?: string; error?: string }>;
};

/**
 * Load a database backup ZIP back into the live database via
 * POST /api/admin/backup/restore. Accepts either a D1 database backup or a
 * Complete app archive (whose nested Database/d1-database-backup.zip is
 * auto-extracted). Additive upsert — never deletes.
 */
function RestoreDatabasePanel() {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<RestoreReport | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    const confirmed = window.confirm(
      `Restore the database from "${file.name}"?\n\n` +
        "Every row in the backup is upserted by primary key:\n" +
        "  • matching rows are OVERWRITTEN with backup values\n" +
        "  • missing rows are INSERTED\n" +
        "  • rows not in the backup are LEFT ALONE (nothing deleted)\n\n" +
        "Continue?",
    );
    if (!confirmed) {
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setBusy(true);
    setReport(null);
    try {
      const blob = await resolveDbZipBlob(file);
      const form = new FormData();
      form.append("file", blob, "database-backup.zip");
      const res = await fetch("/api/admin/backup/restore", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as RestoreReport;
      setReport(data);
    } catch (err) {
      setReport({ ok: false, error: (err as Error).message });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <BackupCard
      icon={Database}
      accent="indigo"
      title="Restore database"
      description="Load a database backup back into the live database — upserts every row by primary key, never deletes."
      included={[
        "Takes a database backup, or a Complete app archive (the database is auto-extracted)",
        "Recreates the schema automatically on a fresh or empty database (Postgres or D1)",
        "Additive & idempotent — safe to re-run; existing rows are overwritten, extras kept",
      ]}
    >
      <UploadButton
        accent="indigo"
        busy={busy}
        inputRef={inputRef}
        onFile={onFile}
        busyLabel="Restoring…"
      >
        Restore database (.zip)
      </UploadButton>
      <DbRestoreReport report={report} />
    </BackupCard>
  );
}

/**
 * If the chosen ZIP is a Complete app archive, pull out the nested database
 * backup; otherwise use the file as-is. Lets the DB restore accept either.
 */
async function resolveDbZipBlob(file: File): Promise<Blob> {
  const buf = await file.arrayBuffer();
  try {
    const zip = await JSZip.loadAsync(buf);
    const nested = zip.file("Database/d1-database-backup.zip");
    if (nested) return await nested.async("blob");
  } catch {
    // Not a readable ZIP here — let the server surface the real error.
  }
  return new Blob([buf], { type: "application/zip" });
}

/** Render the table-by-table restore report. */
function DbRestoreReport({ report }: { report: RestoreReport | null }) {
  if (!report) return null;
  const ok = report.ok;
  return (
    <div
      className={`mt-2 rounded-lg border px-3 py-2 text-sm ${
        ok
          ? "border-green-200 bg-green-50 text-green-700"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      {ok ? (
        <>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div>
                Restore complete
                {report.backupTakenAt ? (
                  <>
                    {" "}
                    from backup of{" "}
                    <strong>
                      {new Date(report.backupTakenAt).toLocaleString()}
                    </strong>
                  </>
                ) : null}
                .
              </div>
              <div className="mt-1">
                Inserted {report.totals?.inserted ?? 0}, updated{" "}
                {report.totals?.updated ?? 0}, skipped{" "}
                {report.totals?.skipped ?? 0}.
              </div>
            </div>
          </div>
          {report.tables && report.tables.some((t) => t.error) && (
            <ul className="mt-2 list-disc pl-5">
              {report.tables
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
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Error: {report.error}</span>
        </div>
      )}
    </div>
  );
}

// ─── Restore: files to R2 ────────────────────────────────────────────────────

/**
 * Re-upload every file from an R2 files backup (or a Complete archive) straight
 * back into R2 at its original key. Reads the backup's _manifest.json, presigns
 * a PUT per storage path, and uploads each blob browser→R2 directly.
 */
function RestoreFilesPanel() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    const confirmed = window.confirm(
      `Restore files to R2 from "${file.name}"?\n\n` +
        "Every file in the backup is re-uploaded to Cloudflare R2 at its " +
        "original key, overwriting any object already there. Continue?",
    );
    if (!confirmed) {
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await restoreFilesFromZip(file, setProgress);
      setMsg({
        kind: r.failed > 0 ? "error" : "ok",
        text:
          `Restored ${r.restored} of ${r.total} file(s) to R2.` +
          (r.failed ? ` ${r.failed} failed — see the browser console.` : ""),
      });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <BackupCard
      icon={Cloud}
      accent="cyan"
      title="Restore files to R2"
      description="Re-upload every file from an R2 files backup (or Complete archive) straight back into R2 at its original key."
      included={[
        "Reads the backup's _manifest.json to map each file to its exact R2 key",
        "Uploads bytes browser→R2 directly via presigned PUT — never through the server",
        "Pair with a database restore to bring file storage fully back after an R2 loss",
      ]}
    >
      <UploadButton
        accent="cyan"
        busy={busy}
        inputRef={inputRef}
        onFile={onFile}
        busyLabel="Restoring…"
      >
        Restore files to R2 (.zip)
      </UploadButton>
      <ProgressMessage progress={progress} />
      <ResultMessage msg={msg} />
    </BackupCard>
  );
}

type RestoreManifestEntry = {
  kind?: string;
  embedded?: boolean;
  storagePath?: string;
  mime?: string;
  zipPath?: string;
};

/**
 * Read a files/complete backup ZIP, presign a PUT per storage path, and upload
 * every file's bytes back into R2. Returns counts. Throws on a fatal problem
 * (not a backup, nothing restorable, presign failure).
 */
async function restoreFilesFromZip(
  file: File,
  onProgress: (text: string) => void,
): Promise<{ restored: number; failed: number; total: number }> {
  onProgress("Reading backup…");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const manifestFile = zip.file("_manifest.json");
  if (!manifestFile) {
    throw new Error(
      "This isn't an R2 files or Complete backup (no _manifest.json inside).",
    );
  }
  const manifest = JSON.parse(
    await manifestFile.async("string"),
  ) as RestoreManifestEntry[];
  const entries = manifest.filter(
    (m) =>
      m.kind === "uploaded-file" &&
      m.embedded === true &&
      typeof m.storagePath === "string" &&
      m.storagePath &&
      typeof m.zipPath === "string" &&
      m.zipPath,
  );
  if (entries.length === 0) {
    throw new Error(
      "No restorable files found. Older backups aren't keyed for re-import — " +
        "take a fresh R2 files backup first.",
    );
  }

  // Presign a PUT URL for every storage path (chunked under the route's cap).
  const storagePaths = Array.from(
    new Set(entries.map((e) => e.storagePath as string)),
  );
  const urlMap: Record<string, string> = {};
  const CHUNK = 1000;
  for (let i = 0; i < storagePaths.length; i += CHUNK) {
    const slice = storagePaths.slice(i, i + CHUNK);
    onProgress(
      `Preparing upload URLs… ${Math.min(i + CHUNK, storagePaths.length)} of ${storagePaths.length}`,
    );
    const res = await fetch("/api/admin/files-restore/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storagePaths: slice }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      urls?: Record<string, string>;
    };
    if (!res.ok || !data.ok || !data.urls) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    Object.assign(urlMap, data.urls);
  }

  let restored = 0;
  let failed = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    onProgress(`Uploading files to R2… ${i + 1} of ${entries.length}`);
    const url = urlMap[e.storagePath as string];
    const zentry = zip.file(e.zipPath as string);
    if (!url || !zentry) {
      failed++;
      continue;
    }
    try {
      const bytes = await zentry.async("arraybuffer");
      const put = await fetch(url, {
        method: "PUT",
        headers: e.mime ? { "Content-Type": e.mime } : undefined,
        body: bytes,
      });
      if (!put.ok) throw new Error(`R2 PUT ${put.status}`);
      restored++;
    } catch {
      failed++;
    }
  }
  return { restored, failed, total: entries.length };
}

// ─── Restore: off-site mirror ────────────────────────────────────────────────

/**
 * Mirror a fresh database snapshot to a second bucket (the off-site
 * destination) so one bucket — or one account — going down can't take the live
 * files and their backups together. Shows a configured / not-configured state
 * from GET /api/admin/offsite-mirror and triggers it via POST.
 */
function OffsiteBackupPanel() {
  const [status, setStatus] = useState<{
    configured: boolean;
    sameAccount: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/offsite-mirror", { method: "GET" });
        const data = await res.json().catch(() => ({}));
        if (alive) {
          setStatus(
            res.ok && data.ok
              ? {
                  configured: !!data.configured,
                  sameAccount: !!data.sameAccount,
                }
              : { configured: false, sameAccount: true },
          );
        }
      } catch {
        if (alive) setStatus({ configured: false, sameAccount: true });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function mirror() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/offsite-mirror", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const mb = data.bytes
        ? (data.bytes / (1024 * 1024)).toFixed(2)
        : "?";
      setMsg({
        kind: "ok",
        text:
          `Database mirrored off-site to "${data.bucket}" (${mb} MB, ${data.rows ?? "?"} rows).` +
          (data.sameAccount
            ? " Note: same account — set CLOUDFLARE_R2_OFFSITE_ACCOUNT_ID for a true off-site copy."
            : ""),
      });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const configured = status?.configured ?? false;
  const badge = !status
    ? undefined
    : configured
      ? status.sameAccount
        ? "Same account"
        : "Off-site ready"
      : "Not configured";

  return (
    <BackupCard
      icon={Globe}
      accent="red"
      title="Off-site backup"
      description="Mirror a fresh database snapshot to a second bucket outside your live storage, so one bucket — or one account — going down can't take everything."
      badge={badge}
      included={[
        "Builds a fresh snapshot and writes it to the off-site bucket (latest + dated copy)",
        "Runs automatically every night once configured — not just on demand",
        "Genuinely off-site when the off-site account differs from your primary account",
      ]}
    >
      {configured ? (
        <ActionButton
          accent="red"
          busy={busy}
          onClick={mirror}
          icon={RefreshCw}
        >
          {busy ? "Mirroring off-site…" : "Back up database off-site now"}
        </ActionButton>
      ) : (
        <div className="rounded-lg border border-magic-border bg-magic-soft px-3 py-2.5 text-xs text-magic-ink/70">
          <p className="font-semibold text-magic-ink/80">Not configured</p>
          <p className="mt-1">
            Set these environment variables to enable off-site mirroring (the
            nightly backup will use them too):
          </p>
          <ul className="mt-1.5 grid gap-0.5 font-mono text-[11px] text-magic-ink/70">
            <li>
              CLOUDFLARE_R2_OFFSITE_BUCKET{" "}
              <span className="font-sans text-magic-ink/45">(required)</span>
            </li>
            <li>CLOUDFLARE_R2_OFFSITE_ACCOUNT_ID</li>
            <li>CLOUDFLARE_R2_OFFSITE_ACCESS_KEY_ID</li>
            <li>CLOUDFLARE_R2_OFFSITE_SECRET_ACCESS_KEY</li>
          </ul>
          <p className="mt-1.5">
            For a real off-site copy, point the account + keys at a{" "}
            <strong>different Cloudflare account</strong>.
          </p>
        </div>
      )}
      <ResultMessage msg={msg} />
    </BackupCard>
  );
}

// ─── Presentational building blocks ──────────────────────────────────────────

type Accent = "indigo" | "cyan" | "red";

const ACCENTS: Record<
  Accent,
  { bar: string; icon: string; check: string; badge: string; button: string }
> = {
  indigo: {
    bar: "from-indigo-500 to-indigo-600",
    icon: "bg-indigo-50 text-indigo-600 ring-indigo-100",
    check: "text-indigo-500",
    badge: "bg-indigo-100 text-indigo-700",
    button: "bg-indigo-600 hover:bg-indigo-700",
  },
  cyan: {
    bar: "from-cyan-500 to-sky-600",
    icon: "bg-cyan-50 text-cyan-600 ring-cyan-100",
    check: "text-cyan-500",
    badge: "bg-cyan-100 text-cyan-700",
    button: "bg-cyan-600 hover:bg-cyan-700",
  },
  red: {
    bar: "from-magic-red to-rose-600",
    icon: "bg-magic-red/10 text-magic-red ring-magic-red/15",
    check: "text-magic-red",
    badge: "bg-magic-red/10 text-magic-red",
    button: "bg-magic-red hover:bg-magic-red/90",
  },
};

/** A polished card shell shared by all three backups. */
function BackupCard({
  icon: Icon,
  accent,
  title,
  description,
  included,
  badge,
  children,
}: {
  icon: LucideIcon;
  accent: Accent;
  title: string;
  description: React.ReactNode;
  included: string[];
  badge?: string;
  children: React.ReactNode;
}) {
  const a = ACCENTS[accent];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-magic-border bg-white shadow-mt-soft">
      <div className={`h-1.5 w-full bg-gradient-to-r ${a.bar}`} />
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ring-1 ${a.icon}`}
          >
            <Icon className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-magic-ink">{title}</h3>
              {badge && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.badge}`}
                >
                  {badge}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-magic-ink/60">{description}</p>

            <ul className="mt-3 grid gap-1.5">
              {included.map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-2 text-xs text-magic-ink/70"
                >
                  <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${a.check}`} />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <div className="mt-4 md:max-w-lg">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The primary action button, accent-coloured, with a spinner while busy. */
function ActionButton({
  accent,
  busy,
  onClick,
  icon: Icon = Download,
  children,
}: {
  accent: Accent;
  busy: boolean;
  onClick: () => void;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors disabled:opacity-50 ${ACCENTS[accent].button}`}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Icon className="h-4 w-4" />
      )}
      {children}
    </button>
  );
}

/**
 * Upload counterpart of ActionButton — a styled label wrapping a hidden file
 * input, so the restore cards match the backup cards visually. Calls `onFile`
 * with the chosen file.
 */
function UploadButton({
  accent,
  busy,
  inputRef,
  onFile,
  busyLabel,
  children,
}: {
  accent: Accent;
  busy: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
  busyLabel: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors ${
        ACCENTS[accent].button
      } ${busy ? "pointer-events-none opacity-50" : ""}`}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Upload className="h-4 w-4" />
      )}
      {busy ? busyLabel : children}
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

/** Live progress line shown while a browser-assembled backup is running. */
function ProgressMessage({ progress }: { progress: string | null }) {
  if (!progress) return null;
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-magic-border bg-magic-soft px-3 py-2 text-sm text-magic-ink/70">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      <span>{progress}</span>
    </div>
  );
}

/** Final success / error banner for a backup. */
function ResultMessage({ msg }: { msg: Msg | null }) {
  if (!msg) return null;
  const ok = msg.kind === "ok";
  return (
    <div
      className={`mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
        ok
          ? "border-green-200 bg-green-50 text-green-700"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span>{msg.text}</span>
    </div>
  );
}

// ─── Generic helpers ─────────────────────────────────────────────────────────

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
      className={`-mb-px flex-shrink-0 whitespace-nowrap px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
        active
          ? "border-magic-red text-magic-red"
          : "border-transparent text-magic-ink/60 hover:text-magic-ink"
      }`}
    >
      {children}
    </button>
  );
}
