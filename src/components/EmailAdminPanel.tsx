"use client";

import { useCallback, useEffect, useState } from "react";
import { confirmDelete } from "@/lib/confirmDelete";

type Encryption = "ssl_tls" | "starttls";

interface ServerConfig {
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  encryption: Encryption;
}

interface AccountRow {
  user_id: number;
  username: string;
  display_name: string | null;
  role: string;
  email_address: string | null;
  mailbox_username: string | null;
  enabled: boolean | null;
  has_password: boolean;
  last_test_ok: boolean | null;
  last_tested_at: string | null;
  last_test_error: string | null;
}

interface TestResult {
  imap: { ok: boolean; error?: string };
  smtp: { ok: boolean; error?: string };
}

const DEFAULT_CONFIG: ServerConfig = {
  imap_host: "",
  imap_port: 993,
  smtp_host: "",
  smtp_port: 465,
  encryption: "ssl_tls",
};

const inputCls =
  "w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none focus:ring-2 focus:ring-magic-red/20";

export default function EmailAdminPanel() {
  const [config, setConfig] = useState<ServerConfig>(DEFAULT_CONFIG);
  const [encryptionReady, setEncryptionReady] = useState(true);
  const [savingCfg, setSavingCfg] = useState(false);
  const [cfgMsg, setCfgMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  const [testUser, setTestUser] = useState("");
  const [testPass, setTestPass] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testErr, setTestErr] = useState<string | null>(null);

  // Per-mailbox test feedback (which row is testing + last error surfaced).
  const [testingUserId, setTestingUserId] = useState<number | null>(null);
  const [accErr, setAccErr] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [editing, setEditing] = useState<AccountRow | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/email/config", { cache: "no-store" });
      const d = await r.json();
      if (d.config) setConfig(d.config);
      setEncryptionReady(d.encryptionReady !== false);
    } catch {
      /* ignore — form keeps defaults */
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/email/accounts", { cache: "no-store" });
      const d = await r.json();
      setAccounts(Array.isArray(d.accounts) ? d.accounts : []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadAccounts();
  }, [loadConfig, loadAccounts]);

  async function saveConfig() {
    setSavingCfg(true);
    setCfgMsg(null);
    try {
      const r = await fetch("/api/admin/email/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setCfgMsg({ kind: "ok", text: "Mail server settings saved." });
    } catch (e) {
      setCfgMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setSavingCfg(false);
    }
  }

  async function testConfig() {
    setTesting(true);
    setTestResult(null);
    setTestErr(null);
    try {
      const r = await fetch("/api/admin/email/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...config,
          username: testUser.trim(),
          password: testPass,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setTestResult(d as TestResult);
    } catch (e) {
      setTestErr((e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  async function testAccount(userId: number) {
    setTestingUserId(userId);
    setAccErr(null);
    try {
      const res = await fetch("/api/admin/email/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        imap?: { ok: boolean; error?: string };
        smtp?: { ok: boolean; error?: string };
      };
      if (!res.ok) {
        // e.g. missing EMAIL_ENCRYPTION_KEY, no server config, no mailbox.
        setAccErr(d.error || `Test failed (HTTP ${res.status}).`);
      } else if (d.imap && d.smtp && !(d.imap.ok && d.smtp.ok)) {
        setAccErr(
          [
            d.imap.ok ? null : `IMAP: ${d.imap.error || "failed"}`,
            d.smtp.ok ? null : `SMTP: ${d.smtp.error || "failed"}`,
          ]
            .filter(Boolean)
            .join(" · "),
        );
      }
    } catch (e) {
      setAccErr((e as Error).message);
    } finally {
      setTestingUserId(null);
      await loadAccounts();
    }
  }

  async function removeAccount(userId: number) {
    if (!confirmDelete("Remove this user's mailbox assignment?")) return;
    await fetch(`/api/admin/email/accounts?user_id=${userId}`, {
      method: "DELETE",
    });
    await loadAccounts();
  }

  return (
    <div className="space-y-6">
      {!encryptionReady && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <b>EMAIL_ENCRYPTION_KEY is not set.</b> Generate one with{" "}
          <code className="rounded bg-amber-100 px-1">openssl rand -base64 32</code>{" "}
          and add it to the environment — mailbox passwords can&apos;t be saved
          securely until it is.
        </div>
      )}

      {/* ── Shared mail server ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-magic-border bg-white p-5">
        <h3 className="font-semibold text-magic-ink mb-1">Mail server</h3>
        <p className="text-sm text-magic-ink/60 mb-4">
          One IMAP/SMTP server for all custom-domain mailboxes (e.g.{" "}
          <code>mail.yourcompany.com</code>). Nothing here is hardcoded.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="IMAP host">
            <input
              className={inputCls}
              value={config.imap_host}
              onChange={(e) => setConfig({ ...config, imap_host: e.target.value })}
              placeholder="mail.yourcompany.com"
            />
          </Field>
          <Field label="IMAP port">
            <input
              type="number"
              className={inputCls}
              value={config.imap_port}
              onChange={(e) =>
                setConfig({ ...config, imap_port: Number(e.target.value) })
              }
            />
          </Field>
          <Field label="SMTP host">
            <input
              className={inputCls}
              value={config.smtp_host}
              onChange={(e) => setConfig({ ...config, smtp_host: e.target.value })}
              placeholder="mail.yourcompany.com"
            />
          </Field>
          <Field label="SMTP port">
            <input
              type="number"
              className={inputCls}
              value={config.smtp_port}
              onChange={(e) =>
                setConfig({ ...config, smtp_port: Number(e.target.value) })
              }
            />
          </Field>
          <Field label="Encryption">
            <select
              className={inputCls}
              value={config.encryption}
              onChange={(e) =>
                setConfig({
                  ...config,
                  encryption: e.target.value as Encryption,
                  imap_port: e.target.value === "starttls" ? 143 : 993,
                  smtp_port: e.target.value === "starttls" ? 587 : 465,
                })
              }
            >
              <option value="ssl_tls">SSL / TLS (IMAP 993, SMTP 465)</option>
              <option value="starttls">STARTTLS (IMAP 143, SMTP 587)</option>
            </select>
          </Field>
        </div>

        {/* Test with a real mailbox before saving */}
        <div className="mt-5 rounded-lg border border-magic-border/70 bg-magic-soft/30 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-magic-ink/60 mb-2">
            Test connection
          </div>
          <p className="text-xs text-magic-ink/60 mb-3">
            Verify the settings above with any real mailbox on this server. These
            credentials are only used for the test — they are not stored.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className={inputCls}
              value={testUser}
              onChange={(e) => setTestUser(e.target.value)}
              placeholder="Test username (full email)"
            />
            <input
              type="password"
              className={inputCls}
              value={testPass}
              onChange={(e) => setTestPass(e.target.value)}
              placeholder="Test password"
            />
          </div>
          <button
            onClick={() => void testConfig()}
            disabled={testing || !config.imap_host || !testUser || !testPass}
            className="mt-3 rounded-lg border border-magic-red px-4 py-2 text-sm font-semibold text-magic-red hover:bg-magic-red hover:text-white disabled:opacity-50 transition-colors"
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          {testErr && (
            <p className="mt-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {testErr}
            </p>
          )}
          {testResult && (
            <div className="mt-2 space-y-1 text-sm">
              <TestLine label="IMAP" outcome={testResult.imap} />
              <TestLine label="SMTP" outcome={testResult.smtp} />
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => void saveConfig()}
            disabled={savingCfg}
            className="rounded-lg bg-magic-red px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {savingCfg ? "Saving…" : "Save mail server settings"}
          </button>
          {cfgMsg && (
            <span
              className={`text-sm ${
                cfgMsg.kind === "ok" ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {cfgMsg.text}
            </span>
          )}
        </div>
      </div>

      {/* ── Per-user mailboxes ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-magic-border bg-white p-5">
        <h3 className="font-semibold text-magic-ink mb-1">User mailboxes</h3>
        <p className="text-sm text-magic-ink/60 mb-4">
          Assign each user an address + password on the server above. Passwords
          are stored AES-256-GCM encrypted. Users read &amp; send from{" "}
          <code>/email</code>.
        </p>
        <div className="overflow-x-auto rounded-lg border border-magic-border">
          <table className="w-full text-sm">
            <thead className="bg-magic-soft/60">
              <tr className="text-left text-xs uppercase text-magic-ink/60">
                <th className="px-3 py-2 font-semibold">User</th>
                <th className="px-3 py-2 font-semibold">Mailbox</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.user_id} className="border-t border-magic-border/60">
                  <td className="px-3 py-2">
                    <div className="font-medium text-magic-ink">
                      {a.display_name || a.username}
                    </div>
                    <div className="text-xs text-magic-ink/50">
                      @{a.username} · {a.role}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {a.email_address ? (
                      <span className="text-magic-ink/80">{a.email_address}</span>
                    ) : (
                      <span className="text-magic-ink/30">— none —</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {testingUserId === a.user_id ? (
                      <span className="text-xs font-semibold text-magic-ink/60">
                        Testing… (can take ~15s)
                      </span>
                    ) : !a.email_address ? (
                      <span className="text-xs text-magic-ink/40">unassigned</span>
                    ) : a.last_test_ok === true ? (
                      <span className="text-xs font-semibold text-emerald-700">
                        ✓ connection OK
                      </span>
                    ) : a.last_test_ok === false ? (
                      <span
                        className="text-xs font-semibold text-red-700"
                        title={a.last_test_error || ""}
                      >
                        ✗ {a.last_test_error || "failed"}
                      </span>
                    ) : a.enabled === false ? (
                      <span className="text-xs text-amber-700">disabled</span>
                    ) : (
                      <span className="text-xs text-magic-ink/40">not tested</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => setEditing(a)}
                        className="rounded border border-magic-border px-2 py-1 text-xs font-medium text-magic-ink/70 hover:bg-magic-soft"
                      >
                        {a.email_address ? "Edit" : "Assign"}
                      </button>
                      {a.email_address && (
                        <>
                          <button
                            onClick={() => void testAccount(a.user_id)}
                            disabled={testingUserId !== null}
                            className="rounded border border-magic-border px-2 py-1 text-xs font-medium text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50"
                          >
                            {testingUserId === a.user_id ? "Testing…" : "Test"}
                          </button>
                          <button
                            onClick={() => void removeAccount(a.user_id)}
                            className="rounded border border-magic-border px-2 py-1 text-xs font-medium text-magic-ink/70 hover:bg-red-50 hover:text-red-700 hover:border-red-300"
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-magic-ink/50">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {accErr && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {accErr}
          </div>
        )}
      </div>

      {editing && (
        <MailboxEditor
          account={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await loadAccounts();
          }}
        />
      )}
    </div>
  );
}

function MailboxEditor({
  account,
  onClose,
  onSaved,
}: {
  account: AccountRow;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [email, setEmail] = useState(account.email_address ?? "");
  const [username, setUsername] = useState(
    account.mailbox_username ?? account.email_address ?? "",
  );
  const [password, setPassword] = useState("");
  const [enabled, setEnabled] = useState(account.enabled !== false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/email/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: account.user_id,
          email_address: email.trim(),
          username: username.trim(),
          password,
          enabled,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      await onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-magic-ink/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl space-y-3"
      >
        <h3 className="font-semibold text-magic-ink">
          Mailbox for {account.display_name || account.username}
        </h3>
        <Field label="Email address">
          <input
            className={inputCls}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@yourcompany.com"
            autoFocus
          />
        </Field>
        <Field label="Login username (defaults to the address)">
          <input
            className={inputCls}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="user@yourcompany.com"
          />
        </Field>
        <Field
          label={
            account.has_password
              ? "Password (leave blank to keep current)"
              : "Password"
          }
        >
          <input
            type="password"
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={account.has_password ? "••••••••" : "Mailbox password"}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-magic-ink/80">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enabled (user can read &amp; send)
        </label>
        {err && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded border border-magic-border px-3 py-1.5 text-sm font-semibold text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={busy || !email.trim()}
            className="rounded bg-magic-red px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save mailbox"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-magic-ink/60">
        {label}
      </span>
      {children}
    </label>
  );
}

function TestLine({
  label,
  outcome,
}: {
  label: string;
  outcome: { ok: boolean; error?: string };
}) {
  return (
    <div
      className={`rounded px-3 py-1.5 ${
        outcome.ok
          ? "bg-emerald-50 text-emerald-800"
          : "bg-red-50 text-red-700"
      }`}
    >
      <b>{label}:</b> {outcome.ok ? "connected ✓" : outcome.error || "failed"}
    </div>
  );
}
