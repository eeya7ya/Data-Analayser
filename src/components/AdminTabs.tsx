"use client";

import { useRef, useState } from "react";
import UsersAndRolesPanel from "./UsersAndRolesPanel";
import AdminSettings from "./AdminSettings";
import FolderClassificationPanel from "./FolderClassificationPanel";
import NewsAdminPanel from "./NewsAdminPanel";
import EmailAdminPanel from "./EmailAdminPanel";
import type { AppSettings } from "@/lib/settings";

type Tab = "users" | "folders" | "news" | "email" | "settings" | "backups";

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

/**
 * Download every uploaded file in its original format, laid out in the same
 * Client → Project → Kind folder structure as the app. Server route:
 * GET /api/admin/files-backup. Reads from Cloudflare R2 only — no Supabase.
 */
function FilesBackupPanel() {
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  async function downloadFilesBackup() {
    setExporting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/files-backup", { method: "GET" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const filename =
        filenameFromResponse(res) ||
        `magictech-files-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
      triggerDownload(blob, filename);
      const mb = (blob.size / (1024 * 1024)).toFixed(2);
      setMsg({
        kind: "ok",
        text: `Files backup downloaded: ${filename} (${mb} MB). Unzip it and the files sit in the same folder/sub-folder layout as the app.`,
      });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="rounded-xl border-2 border-magic-red/40 bg-white p-5">
      <h3 className="font-semibold text-magic-ink mb-1">Files backup</h3>
      <p className="text-sm text-magic-ink/60 mb-4">
        Downloads <strong>every uploaded file</strong> — PDFs, DWGs, Excel
        sheets, photos — in its <strong>exact original format</strong> (the bytes
        as uploaded, never re-rendered), bundled into a single ZIP. Inside, the
        files are organised exactly like the app:{" "}
        <code>Client&nbsp;folder / Project / Kind / filename</code>. Unzip it and
        every file drops straight back into a matching folder and sub-folder, so
        you can copy them onto disk as-is.
      </p>
      <div className="space-y-2 md:max-w-lg">
        <button
          onClick={downloadFilesBackup}
          disabled={exporting}
          className="w-full px-4 py-2 text-sm font-semibold rounded-lg bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
        >
          {exporting ? "Preparing files backup…" : "Download all files (.zip)"}
        </button>
        <p className="text-xs text-magic-ink/50">
          Layout:{" "}
          <code>&lt;Client&gt;/&lt;Project&gt;/&lt;Quotations|Purchase Orders|BOQs|Other&gt;/&lt;file&gt;</code>
          , plus a <code>_manifest.json</code> (folder / project / size / SHA-256
          per file) and a <code>README.txt</code>. Files come straight from
          Cloudflare R2 — nothing is read from Supabase.
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
