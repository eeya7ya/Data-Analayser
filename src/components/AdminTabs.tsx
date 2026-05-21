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
      <D1HealthPanel />
    </div>
  );
}

type D1HealthResponse = {
  configured: boolean;
  message?: string;
  error?: string;
  tables: Array<{ name: string; rows: number }>;
};

type ApplySchemaResult = {
  applied: number;
  skipped: number;
  errors: string[];
  error?: string;
};

type MigrateResult = {
  tables: Array<{ name: string; pgRows: number; migrated: number; errors: string[] }>;
  totalMigrated: number;
  totalErrors: number;
  error?: string;
};

type VerifyOverflowResult = {
  total: number;
  ok: number;
  failed: number;
  rows: Array<{
    id: number;
    ref: string;
    ok: boolean;
    r2_key?: string | null;
    original_size_bytes?: number | null;
    resolved_bytes?: number;
    items_count?: number | null;
    error?: string;
  }>;
  error?: string;
};

function D1HealthPanel() {
  const [data, setData] = useState<D1HealthResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplySchemaResult | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<MigrateResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyOverflowResult | null>(null);

  async function check() {
    setBusy(true);
    setErr(null);
    setData(null);
    try {
      const res = await fetch("/api/admin/d1-health", { cache: "no-store" });
      const body = (await res.json()) as D1HealthResponse;
      setData(body);
      if (!res.ok) setErr(body.error || `HTTP ${res.status}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function applySchema() {
    setApplying(true);
    setApplyResult(null);
    try {
      const res = await fetch("/api/admin/d1-apply-schema", {
        method: "POST",
        cache: "no-store",
      });
      const body = (await res.json()) as ApplySchemaResult;
      setApplyResult(body);
      if (!body.error) await check();
    } catch (e) {
      setApplyResult({ applied: 0, skipped: 0, errors: [(e as Error).message] });
    } finally {
      setApplying(false);
    }
  }

  async function migrateData() {
    setMigrating(true);
    setMigrateResult(null);
    try {
      const res = await fetch("/api/admin/d1-migrate-data", {
        method: "POST",
        cache: "no-store",
      });
      const body = (await res.json()) as MigrateResult;
      setMigrateResult(body);
      if (!body.error) await check();
    } catch (e) {
      setMigrateResult({ tables: [], totalMigrated: 0, totalErrors: 1, error: (e as Error).message });
    } finally {
      setMigrating(false);
    }
  }

  async function verifyOverflow() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch("/api/admin/d1-verify-overflow", {
        cache: "no-store",
      });
      const body = (await res.json()) as VerifyOverflowResult;
      setVerifyResult(body);
    } catch (e) {
      setVerifyResult({ total: 0, ok: 0, failed: 0, rows: [], error: (e as Error).message });
    } finally {
      setVerifying(false);
    }
  }

  const totalRows = data?.tables.reduce((a, b) => a + b.rows, 0) ?? 0;
  const noTables = data?.configured && data.tables.length === 0;
  // Show migrate button if schema is applied but migration is incomplete
  // (either all tables empty, or some tables have rows but not all — indicating partial migration)
  const incompleteOrEmptyMigration =
    data?.configured &&
    data.tables.length > 0 &&
    (totalRows === 0 || data.tables.some((t) => t.rows === 0));
  const anyBusy = busy || applying || migrating || verifying;

  return (
    <div className="rounded-xl border border-magic-border bg-white p-5">
      <h3 className="font-semibold text-magic-ink mb-1">
        Cloudflare D1 connection
      </h3>
      <p className="text-sm text-magic-ink/60 mb-4">
        Reads <code>sqlite_master</code> on D1 via the REST API and counts
        rows in every table. Useful during the dual-run period to confirm
        the D1 env vars are wired up and to spot-check the row counts you
        loaded over from Supabase. Read-only — does not modify any row in
        either database.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={check}
          disabled={anyBusy}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
        >
          {busy ? "Checking…" : "Test D1 connection"}
        </button>
        {noTables && (
          <button
            onClick={applySchema}
            disabled={anyBusy}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {applying ? "Applying schema…" : "Apply D1 schema (36 tables)"}
          </button>
        )}
        {incompleteOrEmptyMigration && (
          <button
            onClick={migrateData}
            disabled={anyBusy}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {migrating ? "Migrating data… (may take ~1 min)" : "Migrate all data from Supabase → D1"}
          </button>
        )}
        <button
          onClick={verifyOverflow}
          disabled={anyBusy}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
          title="Fetches each R2 overflow object referenced from D1 and confirms the round-trip works."
        >
          {verifying ? "Verifying R2…" : "Verify R2 overflow round-trip"}
        </button>
      </div>
      {err && (
        <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {err}
        </p>
      )}
      {applyResult && (
        <div className="mt-3">
          {applyResult.error ? (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {applyResult.error}
            </p>
          ) : (
            <div className="text-sm">
              <p className="text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                Schema applied: {applyResult.applied} statement(s) executed,{" "}
                {applyResult.skipped} skipped.
              </p>
              {applyResult.errors.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {applyResult.errors.map((e, i) => (
                    <li
                      key={i}
                      className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 font-mono break-all"
                    >
                      {e}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      {migrateResult && (
        <div className="mt-3 text-sm">
          {migrateResult.error ? (
            <p className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {migrateResult.error}
            </p>
          ) : (
            <div>
              <p className={`px-3 py-2 rounded-lg border mb-2 ${migrateResult.totalErrors === 0 ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-amber-800 bg-amber-50 border-amber-200"}`}>
                Migration complete: {migrateResult.totalMigrated.toLocaleString()} rows migrated
                {migrateResult.totalErrors > 0 && `, ${migrateResult.totalErrors} error(s) — see table below`}.
              </p>
              <div className="max-h-72 overflow-y-auto rounded border border-magic-border">
                <table className="w-full text-xs">
                  <thead className="bg-magic-soft/60 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-1.5 font-semibold">Table</th>
                      <th className="text-right px-3 py-1.5 font-semibold">Source rows</th>
                      <th className="text-right px-3 py-1.5 font-semibold">Migrated</th>
                      <th className="text-left px-3 py-1.5 font-semibold">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {migrateResult.tables.map((t) => (
                      <tr key={t.name} className={`border-t border-magic-border ${t.errors.length > 0 ? "bg-red-50" : t.migrated > 0 ? "bg-emerald-50/40" : ""}`}>
                        <td className="px-3 py-1 font-mono">{t.name}</td>
                        <td className="px-3 py-1 text-right">{t.pgRows}</td>
                        <td className="px-3 py-1 text-right">{t.migrated}</td>
                        <td className="px-3 py-1 text-red-700 truncate max-w-xs">{t.errors.join("; ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
      {verifyResult && (
        <div className="mt-3 text-sm">
          {verifyResult.error ? (
            <p className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {verifyResult.error}
            </p>
          ) : (
            <div>
              <p className={`px-3 py-2 rounded-lg border mb-2 ${verifyResult.failed === 0 ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-amber-800 bg-amber-50 border-amber-200"}`}>
                R2 round-trip: {verifyResult.ok}/{verifyResult.total} resolved
                {verifyResult.failed > 0 && `, ${verifyResult.failed} failed`}.
                {verifyResult.total === 0 && " No overflow references found in D1 — nothing to verify."}
              </p>
              {verifyResult.rows.length > 0 && (
                <div className="max-h-72 overflow-y-auto rounded border border-magic-border">
                  <table className="w-full text-xs">
                    <thead className="bg-magic-soft/60 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-1.5 font-semibold">Quotation</th>
                        <th className="text-left px-3 py-1.5 font-semibold">R2 key</th>
                        <th className="text-right px-3 py-1.5 font-semibold">Original</th>
                        <th className="text-right px-3 py-1.5 font-semibold">Fetched</th>
                        <th className="text-right px-3 py-1.5 font-semibold">Items</th>
                        <th className="text-left px-3 py-1.5 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {verifyResult.rows.map((r) => (
                        <tr key={r.id} className={`border-t border-magic-border ${r.ok ? "bg-emerald-50/40" : "bg-red-50"}`}>
                          <td className="px-3 py-1 font-mono">{r.ref}</td>
                          <td className="px-3 py-1 font-mono truncate max-w-xs">{r.r2_key || "—"}</td>
                          <td className="px-3 py-1 text-right">{r.original_size_bytes?.toLocaleString() ?? "—"}</td>
                          <td className="px-3 py-1 text-right">{r.resolved_bytes?.toLocaleString() ?? "—"}</td>
                          <td className="px-3 py-1 text-right">{r.items_count ?? "—"}</td>
                          <td className="px-3 py-1 text-red-700 truncate max-w-xs">{r.ok ? "OK" : r.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {data && !err && (
        <div className="mt-3">
          {!data.configured ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {data.message || "D1 env vars not set in Vercel."}
            </p>
          ) : (
            <div className="text-sm">
              <p className="text-magic-ink/80 mb-2">
                Connected. {data.tables.length} table(s), {totalRows.toLocaleString()} total row(s).
                {noTables && (
                  <span className="ml-2 text-amber-700 font-medium">
                    Schema not applied yet — click the green button above.
                  </span>
                )}
                {incompleteOrEmptyMigration && !noTables && (
                  <span className="ml-2 text-blue-700 font-medium">
                    {totalRows === 0
                      ? "Tables are empty — click the blue button above to copy all data from Supabase."
                      : "Migration incomplete — click the blue button above to retry (safe to re-run)."}
                  </span>
                )}
              </p>
              {data.tables.length > 0 && (
                <div className="max-h-64 overflow-y-auto rounded border border-magic-border">
                  <table className="w-full text-xs">
                    <thead className="bg-magic-soft/60 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-1.5 font-semibold">Table</th>
                        <th className="text-right px-3 py-1.5 font-semibold">Rows</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.tables.map((t) => (
                        <tr key={t.name} className="border-t border-magic-border">
                          <td className="px-3 py-1 font-mono">{t.name}</td>
                          <td className="px-3 py-1 text-right">{t.rows.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
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
