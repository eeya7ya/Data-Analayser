"use client";

import { useRef, useState } from "react";
import UserManager from "./UserManager";
import AdminSettings from "./AdminSettings";
import AdminQuotationExport from "./AdminQuotationExport";
import ModuleRolesPanel from "./ModuleRolesPanel";
import FolderClassificationPanel from "./FolderClassificationPanel";
import NewsAdminPanel from "./NewsAdminPanel";
import type { AppSettings } from "@/lib/settings";

type Tab =
  | "users"
  | "modules"
  | "folders"
  | "news"
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
          Users
        </TabButton>
        <TabButton active={tab === "modules"} onClick={() => setTab("modules")}>
          Modules
        </TabButton>
        <TabButton active={tab === "folders"} onClick={() => setTab("folders")}>
          Folders
        </TabButton>
        <TabButton active={tab === "news"} onClick={() => setTab("news")}>
          News
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
          <h2 className="text-lg font-semibold text-magic-ink mb-3">Users</h2>
          <UserManager readOnly={readOnly} />
        </section>
      )}

      {tab === "modules" && (
        <section>
          <h2 className="text-lg font-semibold text-magic-ink mb-3">
            Module roles
          </h2>
          <ModuleRolesPanel readOnly={readOnly} />
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
        <section>
          <h2 className="text-lg font-semibold text-magic-ink mb-3">
            Bulk export
          </h2>
          <AdminQuotationExport />
        </section>
      )}
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

      <BackupPanel />
    </div>
  );
}

type RestoreReport = {
  ok: boolean;
  backupTakenAt?: string;
  totals?: { inserted: number; updated: number; skipped: number };
  tables?: Array<{
    table: string;
    inserted: number;
    updated: number;
    skipped: number;
    error?: string;
  }>;
  error?: string;
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
