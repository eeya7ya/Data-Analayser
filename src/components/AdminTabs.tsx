"use client";

import { useRef, useState } from "react";
import UsersAndRolesPanel from "./UsersAndRolesPanel";
import AdminSettings from "./AdminSettings";
import AdminQuotationExport from "./AdminQuotationExport";
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
  | "database"
  | "export";

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
          active={tab === "database"}
          onClick={() => setTab("database")}
        >
          Database
        </TabButton>
        <TabButton
          active={tab === "export"}
          onClick={() => setTab("export")}
        >
          Export
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

      {tab === "database" && (
        <section>
          <h2 className="text-lg font-semibold text-magic-ink mb-3">
            Database maintenance
          </h2>
          <DatabasePanel />
        </section>
      )}

      {tab === "export" && (
        <section className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-magic-ink mb-3">
              Bulk export
            </h2>
            <AdminQuotationExport />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-magic-ink mb-3">
              Presales backup
            </h2>
            <PresalesBackupPanel />
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * One-click download of everything in the Presales workspace (leads, presales
 * & lead-linked quotations, pricing sheets, and every attached file in its
 * original format) as a single ZIP. Server route: GET /api/admin/presales-backup.
 */
function PresalesBackupPanel() {
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  async function downloadPresalesBackup() {
    setExporting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/presales-backup", { method: "GET" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") || "";
      const match = cd.match(/filename="?([^";]+)"?/i);
      const filename = match
        ? match[1]
        : `presales-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const mb = (blob.size / (1024 * 1024)).toFixed(2);
      setMsg({
        kind: "ok",
        text: `Presales backup downloaded: ${filename} (${mb} MB). Files are kept in their original format.`,
      });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="rounded-xl border border-magic-border bg-white p-5">
      <h3 className="font-semibold text-magic-ink mb-1">
        Back up the Presales workspace
      </h3>
      <p className="text-sm text-magic-ink/60 mb-4">
        One click bundles everything in Presales into a single ZIP: every lead,
        the quotations presales authored (or that are linked to a lead, with
        their items / totals / config), the per-manufacturer pricing sheets,
        and <strong>every attached file in its original format</strong> — the
        exact PDFs, Excel sheets and DWGs as uploaded, not re-rendered copies.
        Read-only: nothing in the database is changed.
      </p>
      <div className="space-y-2 md:max-w-md">
        <button
          onClick={downloadPresalesBackup}
          disabled={exporting}
          className="w-full px-4 py-2 text-sm font-medium rounded-lg bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
        >
          {exporting
            ? "Preparing presales backup…"
            : "Back up Presales (.zip)"}
        </button>
        <p className="text-xs text-magic-ink/50">
          Contains <code>data/leads.json</code>,{" "}
          <code>data/quotations.json</code>,{" "}
          <code>data/pricing_*.json</code> and{" "}
          <code>files/&lt;kind&gt;/&lt;name&gt;</code> (original file bytes),
          plus a <code>README.txt</code> explaining the layout.
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

function DatabasePanel() {
  const [status, setStatus] = useState<
    "idle" | "running" | "ok" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  async function rebaseSchema() {
    setStatus("running");
    setMessage("");
    try {
      const res = await fetch("/api/admin/reset-schema", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (data.ok) {
        setStatus("ok");
        setMessage(data.message ?? "Done.");
      } else {
        setStatus("error");
        setMessage(data.error ?? "Unknown error");
      }
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-magic-border bg-white p-5">
        <h3 className="font-semibold text-magic-ink mb-1">Rebase schema</h3>
        <p className="text-sm text-magic-ink/60 mb-4">
          Re-runs the full database schema bootstrap and applies any pending
          migrations (e.g. new indexes). All statements use{" "}
          <code className="text-xs bg-magic-soft px-1 rounded">IF NOT EXISTS</code>{" "}
          guards —{" "}
          <strong>no quotations, folders or user data is ever modified.</strong>
        </p>
        <button
          onClick={rebaseSchema}
          disabled={status === "running"}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
        >
          {status === "running" ? "Running…" : "Rebase schema"}
        </button>
        {status === "ok" && (
          <p className="mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            {message}
          </p>
        )}
        {status === "error" && (
          <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            Error: {message}
          </p>
        )}
      </div>

      {/* The primary, single-button backup: one click copies the ENTIRE app —
          every database row AND every uploaded file — into Cloudflare R2, so
          nothing depends on Supabase as a single point of failure. The
          download/restore ZIP below is the secondary off-site-copy + restore
          surface. */}
      <FullR2BackupPanel />
      <BackupPanel />
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

function BackupPanel() {
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreReport, setRestoreReport] = useState<RestoreReport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function downloadBackup() {
    setExporting(true);
    setExportMsg(null);
    try {
      const res = await fetch("/api/admin/backup", { method: "GET" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") || "";
      const match = cd.match(/filename="?([^";]+)"?/i);
      const filename = match
        ? match[1]
        : `magictech-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const mb = (blob.size / (1024 * 1024)).toFixed(2);
      setExportMsg({
        kind: "ok",
        text: `Backup downloaded: ${filename} (${mb} MB). Keep at least one copy outside this server.`,
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
        "Take a fresh backup first if you're unsure. Continue?",
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
    <div className="rounded-xl border border-magic-border bg-white p-5">
      <h3 className="font-semibold text-magic-ink mb-1">
        System backup &amp; restore
      </h3>
      <p className="text-sm text-magic-ink/60 mb-4">
        Exports a single ZIP with every public-schema table (JSON / CSV /
        Postgres SQL per table + combined <code>all.sql</code>), the actual
        file bytes from Supabase Storage, a Cloudflare R2 upload script, a
        starter SQLite schema for D1, and SHA-256 content hashes per table
        and per blob. Run <code>node verify-integrity.mjs</code> on the
        unzipped folder to confirm nothing was corrupted. The restore is
        additive: it upserts by primary key and never deletes rows the
        destination already has.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <button
            onClick={downloadBackup}
            disabled={exporting}
            className="w-full px-4 py-2 text-sm font-medium rounded-lg bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
          >
            {exporting ? "Preparing backup…" : "Export full system backup (.zip)"}
          </button>
          <p className="text-xs text-magic-ink/50">
            Includes <code>data/&lt;table&gt;.json</code>,{" "}
            <code>storage/&lt;bucket&gt;/&lt;path&gt;</code> blobs,{" "}
            <code>d1/schema.sql</code>, <code>r2/upload-to-r2.sh</code>,{" "}
            <code>verify-integrity.mjs</code>, and a{" "}
            <code>MIGRATE-TO-CLOUDFLARE.md</code> walkthrough.
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

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const mb = n / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

type LastDbBackup = {
  takenAt: string;
  key: string;
  tableCount: number;
  totalRows: number;
  sizeBytes: number;
};

type FullR2Preview = {
  configured: boolean;
  bucket: string;
  supabaseFiles: { totalFiles: number; totalBytes: number };
  lastDbBackup: LastDbBackup | null;
  latestDownloadUrl: string | null;
};

type FullR2BatchResponse = {
  ok: boolean;
  error?: string;
  done?: boolean;
  db?: {
    done: boolean;
    key: string;
    tableCount: number;
    totalRows: number;
    sizeBytes: number;
    takenAt: string;
  } | null;
  files?: {
    total: number;
    processed: number;
    done: boolean;
    mirrored: number;
    skipped: number;
    missing: number;
    failed: number;
    bytesMirrored: number;
    errors?: Array<{ path: string; error: string }>;
  };
};

type FullR2Report = {
  ok: boolean;
  error?: string;
  db?: FullR2BatchResponse["db"];
  filesTotal: number;
  filesMirrored: number;
  filesBytes: number;
  filesSkipped: number;
  filesMissing: number;
  filesFailed: number;
  errors?: Array<{ path: string; error: string }>;
};

/** POST one batch and parse defensively. A timed-out function returns an HTML
 * 504 page, not JSON — read as text first so we surface a readable error
 * instead of "Unexpected token '<'". */
async function postFullR2Batch(skipDb: boolean): Promise<FullR2BatchResponse> {
  const res = await fetch("/api/admin/backup-to-r2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skipDb }),
  });
  const text = await res.text();
  let data: FullR2BatchResponse | null = null;
  try {
    data = JSON.parse(text) as FullR2BatchResponse;
  } catch {
    /* non-JSON body (timeout / proxy error) */
  }
  if (!res.ok || !data || data.ok === false) {
    throw new Error(
      data?.error || `Server error (HTTP ${res.status}). ${text.slice(0, 140)}`,
    );
  }
  return data;
}

/**
 * THE single backup button. One click copies the entire app into Cloudflare
 * R2: a complete, restore-ready snapshot of every database row PLUS every
 * uploaded file. After it runs, nothing the app stores depends on Supabase as
 * a single point of failure — the DB snapshot and all file blobs live in R2.
 */
function FullR2BackupPanel() {
  const [preview, setPreview] = useState<FullR2Preview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [report, setReport] = useState<FullR2Report | null>(null);

  async function refreshPreview() {
    setLoadingPreview(true);
    setPreviewErr(null);
    try {
      const res = await fetch("/api/admin/backup-to-r2", { method: "GET" });
      const text = await res.text();
      const data = (() => {
        try {
          return JSON.parse(text) as FullR2Preview & { error?: string };
        } catch {
          return null;
        }
      })();
      if (!res.ok || !data) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setPreview(data);
    } catch (err) {
      setPreviewErr((err as Error).message);
    } finally {
      setLoadingPreview(false);
    }
  }

  async function runBackup() {
    setRunning(true);
    setReport(null);
    setProgress(null);
    // First pass snapshots the DB and starts the file mirror; the server
    // time-boxes each call and returns `done:false` while files remain, so we
    // loop with skipDb:true (the DB is already snapshotted) until it's done.
    // The file mirror is idempotent — a file copied on one pass is skipped on
    // the next — so we accumulate the unique "mirrored" tally. The pass cap is
    // a safety net against an unexpected non-terminating loop.
    let dbInfo: FullR2BatchResponse["db"] = null;
    let cumMirrored = 0;
    let cumBytes = 0;
    let last: FullR2BatchResponse | null = null;
    try {
      for (let pass = 0; pass < 100; pass++) {
        const data = await postFullR2Batch(pass > 0);
        if (data.db) dbInfo = data.db;
        cumMirrored += data.files?.mirrored ?? 0;
        cumBytes += data.files?.bytesMirrored ?? 0;
        last = data;
        if (pass === 0 && dbInfo) {
          setProgress(
            `Database snapshot uploaded to R2 (${dbInfo.totalRows} rows across ${dbInfo.tableCount} tables). Now copying files…`,
          );
        } else {
          setProgress(
            `Backing up files… ${cumMirrored} copied so far (${formatBytes(cumBytes)}). Still working…`,
          );
        }
        if (data.done) break;
      }
      const total = last?.files?.total ?? 0;
      const failed = last?.files?.failed ?? 0;
      const missing = last?.files?.missing ?? 0;
      setReport({
        ok: true,
        db: dbInfo,
        filesTotal: total,
        filesMirrored: cumMirrored,
        filesBytes: cumBytes,
        // Everything not newly copied, failed, or missing was already in R2.
        filesSkipped: Math.max(0, total - cumMirrored - failed - missing),
        filesMissing: missing,
        filesFailed: failed,
        errors: last?.files?.errors,
      });
      void refreshPreview();
    } catch (err) {
      const tail =
        cumMirrored > 0 || dbInfo
          ? ` — partial progress was saved to R2 (the backup is idempotent); click "Back up everything to R2" again to finish.`
          : "";
      setReport({
        ok: false,
        error: (err as Error).message + tail,
        filesTotal: 0,
        filesMirrored: cumMirrored,
        filesBytes: cumBytes,
        filesSkipped: 0,
        filesMissing: 0,
        filesFailed: 0,
      });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <div className="rounded-xl border-2 border-magic-red/40 bg-white p-5">
      <h3 className="font-semibold text-magic-ink mb-1">
        Back up everything to Cloudflare R2
      </h3>
      <p className="text-sm text-magic-ink/60 mb-4">
        One click puts the <strong>entire app</strong> into Cloudflare R2: a
        complete, restore-ready snapshot of every database row{" "}
        <em>and</em> every uploaded file. After it finishes, nothing the app
        stores lives only in Supabase — R2 holds a full copy of the data and
        all files, so there&apos;s no single point of failure. Safe to run
        repeatedly: each run writes a fresh, timestamped DB snapshot and skips
        files already in R2.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={runBackup}
          disabled={running}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
        >
          {running ? "Backing up everything to R2…" : "Back up everything to R2"}
        </button>
        <button
          onClick={refreshPreview}
          disabled={loadingPreview}
          className="px-4 py-2 text-sm font-medium rounded-lg border border-magic-border text-magic-ink hover:bg-magic-soft disabled:opacity-50 transition-colors"
        >
          {loadingPreview ? "Checking…" : "Check R2 backup status"}
        </button>
      </div>

      {progress && (
        <p className="mt-3 text-sm text-magic-ink/70 bg-magic-soft border border-magic-border rounded-lg px-3 py-2">
          {progress}
        </p>
      )}

      {preview && (
        <div className="mt-3 text-sm text-magic-ink/70 space-y-1">
          <p>
            Bucket <code>{preview.bucket}</code>.{" "}
            {preview.supabaseFiles.totalFiles > 0 ? (
              <>
                <strong>{preview.supabaseFiles.totalFiles}</strong> file
                {preview.supabaseFiles.totalFiles === 1 ? "" : "s"} (
                {formatBytes(preview.supabaseFiles.totalBytes)}) still in
                Supabase Storage to mirror.
              </>
            ) : (
              <>No legacy files left in Supabase Storage.</>
            )}
          </p>
          {preview.lastDbBackup ? (
            <p>
              Last database snapshot:{" "}
              <strong>
                {new Date(preview.lastDbBackup.takenAt).toLocaleString()}
              </strong>{" "}
              — {preview.lastDbBackup.totalRows} rows,{" "}
              {preview.lastDbBackup.tableCount} tables (
              {formatBytes(preview.lastDbBackup.sizeBytes)}).
              {preview.latestDownloadUrl && (
                <>
                  {" "}
                  <a
                    href={preview.latestDownloadUrl}
                    className="text-magic-red underline hover:no-underline"
                  >
                    Download latest snapshot
                  </a>
                </>
              )}
            </p>
          ) : (
            <p>No database snapshot in R2 yet — run the backup to create one.</p>
          )}
          {!preview.configured && (
            <p className="text-red-700">
              ⚠ R2 is not configured — set CLOUDFLARE_ACCOUNT_ID,
              CLOUDFLARE_R2_ACCESS_KEY_ID and CLOUDFLARE_R2_SECRET_ACCESS_KEY in
              your environment.
            </p>
          )}
        </div>
      )}
      {previewErr && (
        <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Error: {previewErr}
        </p>
      )}

      {report && (
        <div
          className={`mt-3 text-sm rounded-lg px-3 py-2 ${
            report.ok
              ? "text-green-700 bg-green-50 border border-green-200"
              : "text-red-700 bg-red-50 border border-red-200"
          }`}
        >
          {report.ok ? (
            <>
              {report.db && (
                <div>
                  Database snapshot saved to R2:{" "}
                  <strong>{report.db.totalRows}</strong> rows across{" "}
                  <strong>{report.db.tableCount}</strong> tables (
                  {formatBytes(report.db.sizeBytes)}).
                </div>
              )}
              <div className="mt-1">
                Files: backed up <strong>{report.filesMirrored}</strong> new
                file{report.filesMirrored === 1 ? "" : "s"} (
                {formatBytes(report.filesBytes)}). {report.filesSkipped} already
                up to date
                {report.filesMissing
                  ? `, ${report.filesMissing} missing in Supabase`
                  : ""}
                {report.filesFailed ? `, ${report.filesFailed} failed` : ""}.
              </div>
              {report.errors && report.errors.length > 0 && (
                <ul className="mt-2 list-disc pl-5">
                  {report.errors.map((e) => (
                    <li key={e.path} className="text-red-700">
                      {e.path}: {e.error}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>Error: {report.error}</>
          )}
        </div>
      )}
    </div>
  );
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
