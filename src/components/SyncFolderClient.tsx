"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FolderSync,
  FolderOpen,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Play,
  Unplug,
} from "lucide-react";
import {
  isSyncSupported,
  loadDirHandle,
  pickDirectory,
  ensurePermission,
  clearDirHandle,
  runSync,
  type SyncReport,
} from "@/lib/fsSync";

const AUTO_INTERVAL_MS = 45_000;
const AUTO_PREF_KEY = "mt-sync-auto";

type Perm = "unknown" | "granted" | "prompt" | "denied";

export default function SyncFolderClient() {
  const [supported] = useState(isSyncSupported);
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [perm, setPerm] = useState<Perm>("unknown");
  const [syncing, setSyncing] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoOn, setAutoOn] = useState(false);

  // Guards a sync pass so the interval never overlaps a still-running one.
  const runningRef = useRef(false);
  const handleRef = useRef<FileSystemDirectoryHandle | null>(null);
  handleRef.current = handle;

  const doSync = useCallback(async (opts?: { request?: boolean }) => {
    const h = handleRef.current;
    if (!h || runningRef.current) return;
    const ok = await ensurePermission(h, opts?.request ?? false);
    setPerm(ok ? "granted" : "prompt");
    if (!ok) return;
    runningRef.current = true;
    setSyncing(true);
    setError(null);
    try {
      const r = await runSync(h);
      setReport(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      runningRef.current = false;
      setSyncing(false);
    }
  }, []);

  // Restore a previously-picked folder on mount (permission must be re-granted
  // by a gesture, so we only *query* it here — never prompt).
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    (async () => {
      const saved = await loadDirHandle();
      if (!alive || !saved) return;
      setHandle(saved);
      setFolderName(saved.name);
      const granted = await ensurePermission(saved, false);
      setPerm(granted ? "granted" : "prompt");
    })();
    try {
      setAutoOn(localStorage.getItem(AUTO_PREF_KEY) === "1");
    } catch {
      /* ignore */
    }
    return () => {
      alive = false;
    };
  }, [supported]);

  // Auto-sync loop: only while enabled, permission granted, and the tab is
  // visible. Runs once immediately, then on the interval.
  useEffect(() => {
    if (!autoOn || perm !== "granted" || !handle) return;
    void doSync();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void doSync();
    }, AUTO_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [autoOn, perm, handle, doSync]);

  const onChoose = useCallback(async () => {
    setError(null);
    try {
      const picked = await pickDirectory();
      if (!picked) return;
      setHandle(picked);
      setFolderName(picked.name);
      setPerm("granted");
      // handleRef updates on the next render; sync on a microtask so it's set.
      handleRef.current = picked;
      void doSync();
    } catch (e) {
      // AbortError = user dismissed the picker; not an error worth showing.
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    }
  }, [doSync]);

  const onDisconnect = useCallback(async () => {
    await clearDirHandle();
    setHandle(null);
    setFolderName(null);
    setPerm("unknown");
    setReport(null);
    setAutoOn(false);
    try {
      localStorage.removeItem(AUTO_PREF_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleAuto = useCallback(() => {
    setAutoOn((v) => {
      const next = !v;
      try {
        localStorage.setItem(AUTO_PREF_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  if (!supported) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <h2 className="text-sm font-semibold text-magic-ink">
              Not available in this browser
            </h2>
            <p className="mt-1 text-sm text-magic-ink/60">
              Folder sync uses the browser&rsquo;s File System Access API, which
              today only works in <strong>Google Chrome</strong>,{" "}
              <strong>Microsoft Edge</strong> and other Chromium browsers on
              desktop. Open the app in Chrome or Edge to use it.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-magic-red/10 text-magic-red">
              <FolderSync className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-magic-ink">
                {folderName ? folderName : "No folder chosen yet"}
              </h2>
              <p className="text-xs text-magic-ink/55">
                {folderName
                  ? perm === "granted"
                    ? "Connected — files mirror both ways while this tab is open."
                    : "Reconnect to re-grant folder access for this session."
                  : "Pick a folder on your PC to mirror your files into."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!folderName && (
              <Btn onClick={onChoose} primary>
                <FolderOpen className="h-4 w-4" />
                Choose sync folder
              </Btn>
            )}
            {folderName && perm !== "granted" && (
              <Btn onClick={() => void doSync({ request: true })} primary>
                <Play className="h-4 w-4" />
                Reconnect &amp; sync
              </Btn>
            )}
            {folderName && perm === "granted" && (
              <Btn onClick={() => void doSync()} disabled={syncing} primary>
                <RefreshCw
                  className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`}
                />
                {syncing ? "Syncing…" : "Sync now"}
              </Btn>
            )}
            {folderName && (
              <Btn onClick={onChoose}>
                <FolderOpen className="h-4 w-4" />
                Change
              </Btn>
            )}
            {folderName && (
              <Btn onClick={onDisconnect}>
                <Unplug className="h-4 w-4" />
                Disconnect
              </Btn>
            )}
          </div>
        </div>

        {folderName && perm === "granted" && (
          <label className="mt-4 flex items-center gap-2 text-sm text-magic-ink/70">
            <input
              type="checkbox"
              checked={autoOn}
              onChange={toggleAuto}
              className="h-4 w-4 rounded border-magic-border text-magic-red focus:ring-magic-red/30"
            />
            Auto-sync every 45 seconds while this tab is open
          </label>
        )}

        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {report && (
          <div className="mt-3 rounded-lg border border-magic-border bg-magic-soft/40 px-3 py-2.5 text-sm">
            <div className="flex items-center gap-2 font-medium text-magic-ink">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Last sync&nbsp;
              <span className="font-normal text-magic-ink/60">
                {new Date(report.ranAt).toLocaleTimeString()}
              </span>
            </div>
            <div className="mt-1 text-magic-ink/70">
              {report.downloaded} downloaded · {report.uploaded} uploaded ·{" "}
              {report.skipped} already in sync
              {report.errors.length > 0 && (
                <> · {report.errors.length} problem(s)</>
              )}
            </div>
            {report.errors.length > 0 && (
              <ul className="mt-1 max-h-32 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-red-600">
                {report.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-magic-ink">How it works</h3>
        <ul className="mt-2 space-y-1.5 text-sm text-magic-ink/70">
          <li>
            • Files are organised as{" "}
            <code className="rounded bg-magic-soft px-1 py-0.5 text-xs">
              Client / Project [#id] / file
            </code>
            . Anything new in the app is downloaded into that structure.
          </li>
          <li>
            • Drop a file into one of those{" "}
            <code className="rounded bg-magic-soft px-1 py-0.5 text-xs">
              [#id]
            </code>{" "}
            project folders and it uploads to that project on the next sync.
          </li>
          <li>
            • Nothing is ever deleted on either side, and edits to a file the
            app already has aren&rsquo;t re-uploaded (add a differently-named
            file for a new version).
          </li>
          <li>
            • Sync only runs while this tab is open. Chrome/Edge asks you to
            re-grant folder access once per session.
          </li>
        </ul>
      </Card>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-magic-border bg-white p-4 shadow-mt-soft">
      {children}
    </div>
  );
}

function Btn({
  children,
  onClick,
  primary,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
        primary
          ? "bg-magic-red text-white hover:bg-magic-red/90"
          : "border border-magic-border text-magic-ink/75 hover:bg-magic-soft"
      }`}
    >
      {children}
    </button>
  );
}
