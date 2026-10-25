/**
 * Local "sync folder" engine (Option 1 — in-app, File System Access API).
 *
 * Mirrors a member's app files to/from a folder they pick on their PC, WHILE
 * the app tab is open in a Chromium browser (Chrome / Edge / Brave). There is
 * no background daemon: the browser can only touch the folder while the page is
 * open and the folder's read-write permission is granted for the session.
 *
 * The folder is laid out exactly like the app's CRM tree:
 *
 *   Companies/<Company>/<Person>/<Project> [#id]/
 *   Individual clients/<Client>/<Project> [#id]/
 *   Unclassified clients/<Client>/<Project> [#id]/
 *     Quotations/        the project's in-app quotations, as an editable .xlsx,
 *                        a locked "(Read-only)" .xlsx and the read-only,
 *                        watermarked PDF (generated — never uploaded back)
 *     BOQs/  Quotation files/  PO files/  Other files/
 *                        the project's uploaded files, grouped like the app's
 *                        "BOQs / Files" tab
 *   _Pricing/<Manufacturer>/<Project> [#id].xlsx    (Pricing module)
 *
 * Sync is intentionally ADDITIVE / NON-DESTRUCTIVE:
 *   - Down (app → PC): any file missing locally (or a size mismatch) is
 *     downloaded into its project's kind folder. App files are immutable (each
 *     upload is a new row), so a local copy with the right size is current.
 *   - Up (PC → app): a file the member drops into a project's BOQs / Quotation
 *     files / PO files / Other files folder (or straight into the project
 *     folder → Other) that the app doesn't already have is uploaded to that
 *     project with that kind. A file in a kind folder is matched by project,
 *     kind and name (the folders keep same-named files of different kinds
 *     apart); one straight in a project folder, by project and name.
 *   - Nothing is ever deleted on either side. A file the sync itself
 *     downloaded is never pushed back up, so deleting a file in the app does
 *     not resurrect it from the PC copy.
 *
 * Folders of the previous flat layout (`<Client>/<Project> [#id]/`) are left
 * untouched (files dropped there still upload) and reported, so the member can
 * delete them once they have moved to the new tree.
 *
 * The picked directory handle is persisted in IndexedDB so it survives reloads;
 * the browser still requires a user gesture to re-grant read-write permission
 * each session (that's the "Resume sync" button in the UI).
 */

import {
  buildQuotationWorkbookBlob,
  quotationExcelInputFromRow,
} from "@/lib/exportQuotationExcel";
import { buildPricingWorkbookBlob } from "@/lib/exportPricingExcel";
import { createQuotationPdfRenderer, type QuotationPdfRenderer } from "@/lib/quotationPdf";
import type { Constants, ProductInput } from "@/lib/pricing/calculations";

// ── Manifest (GET /api/sync/manifest) ───────────────────────────────────────

type Section = "company" | "individual" | "unclassified";
type FileKind = "boq" | "quotation" | "po" | "other";

export interface SyncCompany {
  id: number;
  name: string;
}

/** A client folder: a person at a company, an individual, or unclassified. */
export interface SyncFolder {
  id: number;
  name: string;
  section: Section;
  companyId: number | null;
}

export interface SyncProject {
  id: number;
  name: string;
  folderId: number;
}

export interface SyncManifestFile {
  id: number;
  projectId: number;
  /** Project folders the file shows in (its own and/or a lead-linked one). */
  placements: number[];
  kind: string;
  filename: string;
  mime: string;
  sizeBytes: number;
}

/** An in-app quotation, rendered to Excel inside each placement's Quotations/. */
export interface SyncQuotation {
  id: number;
  ref: string;
  projectId: number | null;
  placements: number[];
  /** Client folder of a quotation that isn't filed under a live project. */
  folderId: number | null;
  /** The member can open it in the viewer — the source of its PDF. */
  canView?: boolean;
  clientName: string;
  updatedAt: string;
  /** Raw row fed to quotationExcelInputFromRow to build the workbook offline. */
  row: {
    ref?: unknown;
    project_name?: unknown;
    client_name?: unknown;
    client_email?: unknown;
    client_phone?: unknown;
    sales_engineer?: unknown;
    prepared_by?: unknown;
    tax_percent?: unknown;
    items_json?: unknown;
    config_json?: unknown;
  };
}

/** A priced project to render into `_Pricing/<Manufacturer>/<name> [#id].xlsx`. */
export interface SyncPricingProject {
  id: number;
  name: string;
  manufacturerName: string;
  responsiblePerson: string | null;
  targetCurrency: string;
  constants: Constants;
  rows: Array<ProductInput & { position: number }>;
  /** Content hash — re-export only when it moves (pricing has no mtime). */
  fingerprint: string;
}

interface SyncManifest {
  canAuthorQuotations: boolean;
  companies: SyncCompany[];
  folders: SyncFolder[];
  projects: SyncProject[];
  files: SyncManifestFile[];
  quotations: SyncQuotation[];
  pricingProjects: SyncPricingProject[];
}

export interface SyncReport {
  downloaded: number;
  uploaded: number;
  /** Quotations whose .xlsx files were (re)generated this pass. */
  quotations: number;
  /** Quotation PDFs (re)made this pass. */
  pdfs: number;
  /** Quotation PDFs still to make — the next pass carries on with them. */
  pdfsPending: number;
  /** Pricing-project .xlsx files (re)generated this pass. */
  pricing: number;
  skipped: number;
  errors: string[];
  /** Top-level folders still in the previous flat layout (no longer updated). */
  legacyFolders: string[];
  ranAt: number;
}

// ── File System Access API typing shims ────────────────────────────────────
// lib.dom types the handles themselves, but not showDirectoryPicker on Window
// nor the permission methods (a separate spec), so declare the bits we use.
type FsPermState = "granted" | "denied" | "prompt";
interface FsPermissionHandle {
  queryPermission?(d: { mode: "read" | "readwrite" }): Promise<FsPermState>;
  requestPermission?(d: { mode: "read" | "readwrite" }): Promise<FsPermState>;
}
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: {
      mode?: "read" | "readwrite";
      id?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  }
  // The async-iterator entries() isn't in this project's lib.dom yet.
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }
}

/** True when the browser exposes the File System Access API we depend on. */
export function isSyncSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.showDirectoryPicker === "function"
  );
}

// ── IndexedDB persistence for the directory handle ─────────────────────────
const IDB_NAME = "magictech-sync";
const IDB_STORE = "handles";
const IDB_KEY = "dir";

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openIdb();
    const handle = await new Promise<FileSystemDirectoryHandle | null>(
      (resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = () =>
          resolve((req.result as FileSystemDirectoryHandle) ?? null);
        req.onerror = () => reject(req.error);
      },
    );
    db.close();
    return handle;
  } catch {
    return null;
  }
}

export async function clearDirHandle(): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* ignore */
  }
}

/** Prompt the member to pick a folder, then remember it for next time. */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isSyncSupported()) return null;
  const handle = await window.showDirectoryPicker!({
    mode: "readwrite",
    id: "magictech-sync-folder",
  });
  await saveDirHandle(handle);
  return handle;
}

/**
 * Ensure we hold read-write permission on the folder. `request: true` may
 * prompt the user, so it must be called from a user gesture (a button click).
 */
export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  request: boolean,
): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandle & FsPermissionHandle;
  const opts = { mode: "readwrite" as const };
  try {
    if ((await h.queryPermission?.(opts)) === "granted") return true;
    if (request && (await h.requestPermission?.(opts)) === "granted") {
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

// ── Layout ──────────────────────────────────────────────────────────────────

const SECTION_DIRS: Record<Section, string> = {
  company: "Companies",
  individual: "Individual clients",
  unclassified: "Unclassified clients",
};
const PRICING_DIR = "_Pricing";
const QUOTATIONS_DIR = "Quotations";
const UNFILED_QUOTATIONS_DIR = "Quotations (no project)";
const READ_ONLY_SUFFIX = " (Read-only)";
/** One folder per kind, named like the groups in the app's BOQs / Files tab. */
const KIND_DIRS: Record<FileKind, string> = {
  boq: "BOQs",
  quotation: "Quotation files",
  po: "PO files",
  other: "Other files",
};
/** Folder name (lower-cased) → the kind a file dropped there is uploaded as. */
const UPLOAD_KIND_BY_DIR = new Map<string, FileKind>(
  (Object.entries(KIND_DIRS) as Array<[FileKind, string]>).map(([k, d]) => [
    d.toLowerCase(),
    k,
  ]),
);

function fileKind(raw: string): FileKind {
  return raw === "boq" || raw === "quotation" || raw === "po" ? raw : "other";
}

// Windows' MAX_PATH is 260 characters for the WHOLE path, and this tree nests
// up to six levels, so individual names are kept short.
const MAX_DIR_NAME = 60;
const MAX_FILE_NAME = 100;

/** Cut to `max` code points (never splitting a surrogate pair). */
function clipChars(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join("") : s;
}

/**
 * Make one path segment that every OS accepts AND that Chromium's File System
 * Access API allows (it rejects more than the OS does — that is what produced
 * "getDirectoryHandle … Name is not allowed" for a client named ". (2)"):
 *   - control and invisible format characters (bidi marks, zero-width joiners,
 *     BOM — common in pasted Arabic names) are dropped;
 *   - `\ / : * ? " < > | ~` become "_";
 *   - leading / trailing whitespace and dots are trimmed (Windows drops
 *     trailing ones; Chromium refuses names that start or end with them);
 *   - Windows device names (CON, NUL, COM1, …) get a "_" prefix;
 *   - lone surrogates (malformed text) become "_".
 * Never returns empty — falls back to `fallback`.
 */
function safeName(input: string, fallback: string, max: number): string {
  const tidy = (s: string) => s.replace(/^[\s.]+|[\s.]+$/gu, "");
  let s = String(input ?? "")
    .normalize("NFC")
    .replace(/[\t\n\r\v\f]/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "_")
    .replace(/[\\/:*?"<>|~]/g, "_")
    .replace(/\s+/gu, " ");
  s = tidy(clipChars(tidy(s), max));
  if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i.test(s)) {
    s = `_${s}`;
  }
  return s || fallback;
}

/** A company / person / client folder name. Never ends in "[#n]", which
 *  would make the upload scan mistake it for a project folder. */
function entityDirName(name: string, fallback: string): string {
  return safeName(name, fallback, MAX_DIR_NAME).replace(/\[#(\d+)\]$/, "[$1]");
}

/** Folder name for a project, carrying its id so up-sync can route uploads. */
function projectDirName(p: { id: number; name: string }): string {
  return `${safeName(p.name, "Project", MAX_DIR_NAME)} [#${p.id}]`;
}

/** Parse the `[#123]` project id out of a project folder name. */
function projectIdFromFolder(name: string): number | null {
  const m = name.match(/\[#(\d+)\]\s*$/);
  return m ? Number(m[1]) : null;
}

/** A file name; the extension is kept when the name has to be shortened. */
function safeFileName(input: string, fallback: string): string {
  const name = safeName(input, fallback, 10_000);
  if (Array.from(name).length <= MAX_FILE_NAME) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
  const stem = safeName(name.slice(0, name.length - ext.length), fallback, MAX_FILE_NAME - ext.length);
  return `${stem}${ext}`;
}

/** Insert " (n)" before a file's extension: "BOQ.xlsx" → "BOQ (2).xlsx". */
function numbered(name: string, n: number, isFile: boolean): string {
  if (!isFile) return `${name} (${n})`;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

/**
 * Give siblings unique names, case-insensitively (Windows and macOS would
 * otherwise merge "Ahmad" and "AHMAD" into one folder). Items are taken in id
 * order, so the oldest keeps the plain name and the numbering is stable.
 */
function uniqueNames<T>(
  items: T[],
  id: (t: T) => number,
  name: (t: T) => string,
  isFile = false,
): Map<number, string> {
  const out = new Map<number, string>();
  const used = new Set<string>();
  for (const item of [...items].sort((a, b) => id(a) - id(b))) {
    const base = name(item);
    let candidate = base;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) {
      candidate = numbered(base, n, isFile);
    }
    used.add(candidate.toLowerCase());
    out.set(id(item), candidate);
  }
  return out;
}

/**
 * The name the previous engine gave a file, so copies it already downloaded
 * (still sitting in old-layout folders) are recognised and never re-uploaded.
 */
function legacySafeSegment(input: string): string {
  return (input || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
}

interface Layout {
  companyDirs: string[][];
  folderDirs: Map<number, string[]>;
  projectDirs: Map<number, string[]>;
}

function buildLayout(m: SyncManifest): Layout {
  const companyNames = uniqueNames(
    m.companies,
    (c) => c.id,
    (c) => entityDirName(c.name, "Company"),
  );
  const companyDir = (companyId: number | null) => [
    SECTION_DIRS.company,
    (companyId !== null && companyNames.get(companyId)) ||
      entityDirName(`Company ${companyId ?? ""}`, "Company"),
  ];

  // Unique names among siblings: people within one company, and clients
  // within the Individual / Unclassified sections.
  const groups = new Map<string, SyncFolder[]>();
  for (const f of m.folders) {
    const key = f.section === "company" ? `company:${f.companyId}` : f.section;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  const folderDirs = new Map<number, string[]>();
  for (const list of groups.values()) {
    const names = uniqueNames(list, (f) => f.id, (f) => entityDirName(f.name, "Client"));
    for (const f of list) {
      const parent =
        f.section === "company" ? companyDir(f.companyId) : [SECTION_DIRS[f.section]];
      folderDirs.set(f.id, [...parent, names.get(f.id)!]);
    }
  }

  const projectDirs = new Map<number, string[]>();
  for (const p of m.projects) {
    const parent = folderDirs.get(p.folderId) ?? [
      SECTION_DIRS.unclassified,
      entityDirName("", "Client"),
    ];
    projectDirs.set(p.id, [...parent, projectDirName(p)]);
  }

  return {
    companyDirs: m.companies.map((c) => companyDir(c.id)),
    folderDirs,
    projectDirs,
  };
}

// ── Folder handles (cached for the session) ─────────────────────────────────
// Each sync pass re-touches the same few thousand folders; resolving them once
// per page session keeps a 45-second auto-sync cheap.
const dirCaches = new WeakMap<
  FileSystemDirectoryHandle,
  Map<string, FileSystemDirectoryHandle>
>();

async function getDir(
  root: FileSystemDirectoryHandle,
  segs: string[],
): Promise<FileSystemDirectoryHandle> {
  let cache = dirCaches.get(root);
  if (!cache) {
    cache = new Map();
    dirCaches.set(root, cache);
  }
  let handle = root;
  let key = "";
  for (const seg of segs) {
    key = key ? `${key}/${seg}` : seg;
    const hit = cache.get(key);
    if (hit) {
      handle = hit;
      continue;
    }
    handle = await handle.getDirectoryHandle(seg, { create: true });
    cache.set(key, handle);
  }
  return handle;
}

/** Run `fn` in the folder at `segs`, creating it as needed. If a cached folder
 *  was deleted while the tab was open, forget the cache and retry once. */
async function inDir<T>(
  root: FileSystemDirectoryHandle,
  segs: string[],
  fn: (dir: FileSystemDirectoryHandle) => Promise<T>,
): Promise<T> {
  try {
    return await fn(await getDir(root, segs));
  } catch (e) {
    if ((e as DOMException)?.name !== "NotFoundError") throw e;
    dirCaches.delete(root);
    return fn(await getDir(root, segs));
  }
}

async function localSize(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<number | null> {
  try {
    return (await (await dir.getFileHandle(name)).getFile()).size;
  } catch {
    return null;
  }
}

async function writeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  blob: Blob,
): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (e) {
    await writable.abort().catch(() => {});
    throw e;
  }
}

/** System / temp files we never upload. */
function isIgnoredFile(name: string): boolean {
  if (!name || name.startsWith(".") || name.startsWith("~")) return true;
  const lower = name.toLowerCase();
  return (
    lower === "thumbs.db" ||
    lower === "desktop.ini" ||
    lower.endsWith(".crdownload") ||
    lower.endsWith(".tmp")
  );
}

// ── Server calls ────────────────────────────────────────────────────────────

async function fetchManifest(): Promise<SyncManifest> {
  const res = await fetch("/api/sync/manifest", { cache: "no-store" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `manifest HTTP ${res.status}`);
  }
  const data = (await res.json()) as Partial<SyncManifest> & { version?: number };
  if (data.version !== 2 || !Array.isArray(data.projects)) {
    // The tab is newer than the server (a deploy in progress). Refuse rather
    // than guess a layout — the next pass after the deploy will work.
    throw new Error("the server is being updated — try again in a minute");
  }
  return {
    canAuthorQuotations: Boolean(data.canAuthorQuotations),
    companies: data.companies ?? [],
    folders: data.folders ?? [],
    projects: data.projects ?? [],
    files: data.files ?? [],
    quotations: data.quotations ?? [],
    pricingProjects: data.pricingProjects ?? [],
  };
}

/** Download one app file's bytes through the access-checked presign. */
async function fetchFileBlob(fileId: number): Promise<Blob> {
  const metaRes = await fetch(`/api/project-files/${fileId}`, {
    cache: "no-store",
  });
  if (!metaRes.ok) throw new Error(`sign HTTP ${metaRes.status}`);
  const meta = (await metaRes.json()) as { url?: string };
  if (!meta.url) throw new Error("no download url");
  const blobRes = await fetch(meta.url);
  if (!blobRes.ok) throw new Error(`download HTTP ${blobRes.status}`);
  return blobRes.blob();
}

/** Upload one local file into its project via the two-phase upload flow. */
async function uploadFile(
  projectId: number,
  kind: FileKind,
  file: File,
): Promise<void> {
  const mime = file.type || "application/octet-stream";
  const forbidden = () =>
    new Error(
      kind === "quotation"
        ? `only presales can add quotation files — put it in "${KIND_DIRS.other}" instead`
        : "read-only — you can view this project's files but can't upload here",
    );
  const signRes = await fetch("/api/project-files/sign-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      kind,
      filename: file.name,
      mime,
      size_bytes: file.size,
    }),
  });
  const signData = (await signRes.json().catch(() => ({}))) as {
    signedUrl?: string;
    storage_path?: string;
    error?: string;
  };
  if (!signRes.ok || !signData.signedUrl || !signData.storage_path) {
    if (signRes.status === 403) throw forbidden();
    throw new Error(signData.error || `sign HTTP ${signRes.status}`);
  }
  const putRes = await fetch(signData.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": mime },
    body: file,
  });
  if (!putRes.ok) throw new Error(`upload HTTP ${putRes.status}`);
  const regRes = await fetch("/api/project-files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      kind,
      filename: file.name,
      mime,
      size_bytes: file.size,
      storage_path: signData.storage_path,
    }),
  });
  if (!regRes.ok) {
    if (regRes.status === 403) throw forbidden();
    const data = (await regRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `register HTTP ${regRes.status}`);
  }
}

// ── Sync-state file ─────────────────────────────────────────────────────────
// Quotations and pricing projects are re-exported only when they change, and
// every file the sync downloads is remembered so it's never pushed back up.
const STATE_FILE = ".magictech-sync.json";

interface SyncState {
  /** `<quotation id>|<folder path>` → updated_at last written there. */
  quotations: Record<string, string>;
  /** Same key → updated_at of the PDF last written there. */
  pdfs: Record<string, string>;
  /** pricing project id → last-written content fingerprint. */
  pricing: Record<string, string>;
  /** `<project id>/<kind>/<lower-cased local name>` → app file id we downloaded. */
  downloaded: Record<string, number>;
}

async function readState(root: FileSystemDirectoryHandle): Promise<SyncState> {
  const obj = (v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? v : {};
  try {
    const fh = await root.getFileHandle(STATE_FILE);
    const parsed = JSON.parse(await (await fh.getFile()).text()) as Partial<SyncState>;
    return {
      quotations: obj(parsed.quotations) as SyncState["quotations"],
      pdfs: obj(parsed.pdfs) as SyncState["pdfs"],
      pricing: obj(parsed.pricing) as SyncState["pricing"],
      downloaded: obj(parsed.downloaded) as SyncState["downloaded"],
    };
  } catch {
    return { quotations: {}, pdfs: {}, pricing: {}, downloaded: {} };
  }
}

async function writeState(
  root: FileSystemDirectoryHandle,
  state: SyncState,
): Promise<void> {
  try {
    await writeFile(
      root,
      STATE_FILE,
      new Blob([JSON.stringify(state)], { type: "application/json" }),
    );
  } catch {
    /* best-effort — a missing state file just means we re-check next pass */
  }
}

/** A file of a project, by kind — the kind folders hold same-named files apart. */
const fileKey = (projectId: number, kind: FileKind, localName: string) =>
  `${projectId}/${kind}/${localName.toLowerCase()}`;
/** The same file, whatever its kind. */
const anyKindKey = (projectId: number, localName: string) =>
  `${projectId}/${localName.toLowerCase()}`;

// ── The sync run ─────────────────────────────────────────────────────────────

/** Time a pass spends on PDFs before it hands the rest to the next pass. */
const PDF_BUDGET_MS = 90_000;

export interface SyncOptions {
  /** Progress line for the UI while a slow step (PDFs) runs. */
  onProgress?: (message: string) => void;
}

/**
 * Run one full sync pass (tree, down, exports, up, PDFs). Assumes read-write
 * permission is already granted (call ensurePermission first). Errors on
 * individual items are collected into the report rather than aborting.
 */
export async function runSync(
  root: FileSystemDirectoryHandle,
  opts: SyncOptions = {},
): Promise<SyncReport> {
  const report: SyncReport = {
    downloaded: 0,
    uploaded: 0,
    quotations: 0,
    pdfs: 0,
    pdfsPending: 0,
    pricing: 0,
    skipped: 0,
    errors: [],
    legacyFolders: [],
    ranAt: Date.now(),
  };
  const m = await fetchManifest();
  const layout = buildLayout(m);
  const state = await readState(root);
  const path = (segs: string[]) => segs.join("/");
  const projectSegs = (projectId: number) =>
    layout.projectDirs.get(projectId) ?? [
      SECTION_DIRS.unclassified,
      entityDirName("", "Client"),
      projectDirName({ id: projectId, name: "" }),
    ];

  // Local names inside each project's kind folder, unique per folder.
  const placed = new Map<string, SyncManifestFile[]>();
  for (const f of m.files) {
    for (const pid of f.placements) {
      const key = `${pid}\u0000${fileKind(f.kind)}`;
      if (!placed.has(key)) placed.set(key, []);
      placed.get(key)!.push(f);
    }
  }
  const localNames = new Map<string, Map<number, string>>();
  for (const [key, list] of placed) {
    localNames.set(
      key,
      uniqueNames(list, (f) => f.id, (f) => safeFileName(f.filename, `file-${f.id}`), true),
    );
  }
  const localNameOf = (f: SyncManifestFile, pid: number) =>
    localNames.get(`${pid}\u0000${fileKind(f.kind)}`)!.get(f.id)!;

  // ── 1. The folder tree (empty projects included, so there's always somewhere
  //       to drop a file) ─────────────────────────────────────────────────────
  const hasQuotationFiles = new Set(
    m.files.filter((f) => fileKind(f.kind) === "quotation").flatMap((f) => f.placements),
  );
  const treeDirs: string[][] = [...layout.companyDirs, ...layout.folderDirs.values()];
  for (const p of m.projects) {
    const segs = projectSegs(p.id);
    treeDirs.push(segs);
    for (const kind of ["boq", "quotation", "po", "other"] as FileKind[]) {
      // Only presales can add quotation files, so don't offer others a
      // drop target the server would refuse.
      if (kind === "quotation" && !m.canAuthorQuotations && !hasQuotationFiles.has(p.id)) {
        continue;
      }
      treeDirs.push([...segs, KIND_DIRS[kind]]);
    }
  }
  for (const segs of treeDirs) {
    try {
      await inDir(root, segs, async () => undefined);
    } catch (e) {
      report.errors.push(`▸ ${path(segs)}: ${(e as Error).message}`);
    }
  }

  // ── 2. Down: app files → their project's kind folder ─────────────────────
  for (const f of m.files) {
    let blob: Blob | null = null; // fetched once, even with two placements
    for (const pid of f.placements) {
      const segs = [...projectSegs(pid), KIND_DIRS[fileKind(f.kind)]];
      const name = localNameOf(f, pid);
      try {
        const outcome = await inDir(root, segs, async (dir) => {
          // Immutable app files: a local copy of the right size is current.
          if ((await localSize(dir, name)) === f.sizeBytes) return "skipped";
          blob ??= await fetchFileBlob(f.id);
          await writeFile(dir, name, blob);
          return "downloaded";
        });
        state.downloaded[fileKey(pid, fileKind(f.kind), name)] = f.id;
        if (outcome === "downloaded") report.downloaded++;
        else report.skipped++;
      } catch (e) {
        report.errors.push(`↓ ${path(segs)}/${name}: ${(e as Error).message}`);
      }
    }
  }

  // Where a quotation's exports go: each placement's Quotations/, or its
  // client folder's "Quotations (no project)".
  const quotationDirs = (quot: SyncQuotation): string[][] =>
    quot.placements.length > 0
      ? quot.placements.map((pid) => [...projectSegs(pid), QUOTATIONS_DIR])
      : [
          [
            ...(quot.folderId !== null && layout.folderDirs.get(quot.folderId)
              ? layout.folderDirs.get(quot.folderId)!
              : [SECTION_DIRS.unclassified, entityDirName(quot.clientName, "Client")]),
            UNFILED_QUOTATIONS_DIR,
          ],
        ];
  const quotationBase = (quot: SyncQuotation) =>
    safeName(quot.ref, `quotation-${quot.id}`, MAX_FILE_NAME - 20);

  // ── 3. Quotations → editable + read-only Excel in each placement ─────────
  for (const quot of m.quotations) {
    const dirs = quotationDirs(quot);
    const base = quotationBase(quot);
    const editableName = `${base}.xlsx`;
    const lockedName = `${base}${READ_ONLY_SUFFIX}.xlsx`;
    let blobs: { editable: Blob; locked: Blob } | null | undefined;
    let wrote = false;
    for (const segs of dirs) {
      const stateKey = `${quot.id}|${path(segs)}`;
      try {
        const outcome = await inDir(root, segs, async (dir) => {
          const current =
            state.quotations[stateKey] === quot.updatedAt &&
            (await localSize(dir, editableName)) !== null &&
            (await localSize(dir, lockedName)) !== null;
          if (current) return "skipped";
          if (blobs === undefined) {
            const input = quotationExcelInputFromRow(quot.row);
            const editable = await buildQuotationWorkbookBlob(input);
            const locked = await buildQuotationWorkbookBlob(input, { lock: true });
            blobs = editable && locked ? { editable, locked } : null;
          }
          if (!blobs) return "skipped"; // no items → nothing to export
          await writeFile(dir, editableName, blobs.editable);
          await writeFile(dir, lockedName, blobs.locked);
          state.quotations[stateKey] = quot.updatedAt;
          return "written";
        });
        if (outcome === "written") wrote = true;
        else report.skipped++;
      } catch (e) {
        report.errors.push(`⤓ ${path(segs)}/${editableName}: ${(e as Error).message}`);
      }
    }
    if (wrote) report.quotations++;
  }

  // ── 4. Pricing projects → _Pricing/<Manufacturer>/ (rendered to Excel) ───
  for (const proj of m.pricingProjects) {
    const segs = [PRICING_DIR, entityDirName(proj.manufacturerName, "Manufacturer")];
    const name = `${safeName(proj.name, `project-${proj.id}`, MAX_FILE_NAME - 20)} [#${proj.id}].xlsx`;
    const key = String(proj.id);
    try {
      const outcome = await inDir(root, segs, async (dir) => {
        if (state.pricing[key] === proj.fingerprint && (await localSize(dir, name)) !== null) {
          return "skipped";
        }
        const blob = await buildPricingWorkbookBlob({
          projectName: proj.name,
          manufacturerName: proj.manufacturerName,
          responsiblePerson: proj.responsiblePerson,
          targetCurrency: proj.targetCurrency,
          constants: proj.constants,
          rows: proj.rows,
        });
        if (!blob) return "skipped"; // no priced lines → nothing to export
        await writeFile(dir, name, blob);
        state.pricing[key] = proj.fingerprint;
        return "written";
      });
      if (outcome === "written") report.pricing++;
      else report.skipped++;
    } catch (e) {
      report.errors.push(`⤓ ${path(segs)}/${name}: ${(e as Error).message}`);
    }
  }
  await writeState(root, state);

  // ── 5. Up: files dropped into a project's folders → app ──────────────────
  // Everything the app already has, under every name a local copy can carry:
  // the current local name, the raw name, and the old engine's name — by kind
  // (for a file dropped in a kind folder) and whatever the kind (for one
  // straight in the project folder, where no kind was chosen).
  const present = new Set<string>();
  const presentAnyKind = new Set<string>();
  for (const f of m.files) {
    const kind = fileKind(f.kind);
    for (const pid of new Set([...f.placements, f.projectId])) {
      const names = [f.filename, safeFileName(f.filename, ""), legacySafeSegment(f.filename)];
      if (f.placements.includes(pid)) names.push(localNameOf(f, pid));
      for (const n of names) {
        present.add(fileKey(pid, kind, n));
        presentAnyKind.add(anyKindKey(pid, n));
      }
    }
  }
  const downloadedAnyKind = new Set(
    Object.keys(state.downloaded).map((k) => {
      const [pid, , ...name] = k.split("/");
      return `${pid}/${name.join("/")}`;
    }),
  );

  const sectionDirs = new Set(Object.values(SECTION_DIRS).map((d) => d.toLowerCase()));
  const legacy = new Set<string>();
  const drops: Array<{
    projectId: number;
    kind: FileKind;
    /** Dropped in a kind folder (vs. straight in the project folder → other). */
    chosen: boolean;
    handle: FileSystemFileHandle;
    label: string;
  }> = [];

  const collectProject = async (projectId: number, dir: FileSystemDirectoryHandle, label: string) => {
    for await (const [name, entry] of dir.entries()) {
      if (entry.kind === "file") {
        drops.push({
          projectId,
          kind: "other",
          chosen: false,
          handle: entry as FileSystemFileHandle,
          label: `${label}/${name}`,
        });
        continue;
      }
      const kind = UPLOAD_KIND_BY_DIR.get(name.toLowerCase());
      if (!kind) continue; // Quotations (generated), old _Quotations, user subfolders
      for await (const [fileName, fileEntry] of (entry as FileSystemDirectoryHandle).entries()) {
        if (fileEntry.kind !== "file") continue;
        drops.push({
          projectId,
          kind,
          chosen: true,
          handle: fileEntry as FileSystemFileHandle,
          label: `${label}/${name}/${fileName}`,
        });
      }
    }
  };

  // Project folders sit 1 (old flat layout), 2 (Individual / Unclassified) or
  // 3 (Companies) levels below the root; nothing deeper is walked.
  const walk = async (dir: FileSystemDirectoryHandle, segs: string[]) => {
    for await (const [name, entry] of dir.entries()) {
      if (entry.kind !== "directory" || name.startsWith(".")) continue;
      if (segs.length === 0 && name.toLowerCase() === PRICING_DIR.toLowerCase()) continue;
      const child = entry as FileSystemDirectoryHandle;
      const projectId = projectIdFromFolder(name);
      if (projectId !== null) {
        if (segs.length === 1 && !sectionDirs.has(segs[0].toLowerCase())) legacy.add(segs[0]);
        await collectProject(projectId, child, path([...segs, name]));
      } else if (segs.length <= 2) {
        await walk(child, [...segs, name]);
      }
    }
  };
  try {
    await walk(root, []);
  } catch (e) {
    report.errors.push(`scan: ${(e as Error).message}`);
  }
  report.legacyFolders = [...legacy].sort((a, b) => a.localeCompare(b));

  for (const drop of drops) {
    const name = drop.handle.name;
    if (isIgnoredFile(name)) continue;
    const key = fileKey(drop.projectId, drop.kind, name);
    const anyKey = anyKindKey(drop.projectId, name);
    // A file the app already has — or one the sync downloaded earlier that is
    // gone from the app now (deleted or unshared there): don't bring it back.
    const known = drop.chosen
      ? present.has(key) || state.downloaded[key] !== undefined
      : presentAnyKind.has(anyKey) || downloadedAnyKind.has(anyKey);
    if (known) continue;
    try {
      const file = await drop.handle.getFile();
      if (file.size <= 0) continue; // sign-upload rejects empty files
      await uploadFile(drop.projectId, drop.kind, file);
      report.uploaded++;
      // Don't double-upload within this pass.
      present.add(key);
      presentAnyKind.add(anyKey);
    } catch (e) {
      report.errors.push(`↑ ${drop.label}: ${(e as Error).message}`);
    }
  }

  // ── 6. Quotations → the read-only, watermarked PDF (last: it's the slow
  //       part, so files and Excel never wait on it) ────────────────────────
  await writeQuotationPdfs(root, m, state, report, quotationDirs, quotationBase, opts);
  return report;
}

/**
 * Write `<REF>.pdf` — the same read-only, watermarked, encrypted document as
 * the app's PDF Full — next to each quotation's Excel files. Rebuilt only when
 * the quotation changed or the file is missing. Spends at most PDF_BUDGET_MS
 * per pass and records progress after every quotation, so a large first sync
 * carries on across passes (and survives the tab closing) instead of
 * holding everything else up.
 */
async function writeQuotationPdfs(
  root: FileSystemDirectoryHandle,
  m: SyncManifest,
  state: SyncState,
  report: SyncReport,
  quotationDirs: (quot: SyncQuotation) => string[][],
  quotationBase: (quot: SyncQuotation) => string,
  opts: SyncOptions,
): Promise<void> {
  const path = (segs: string[]) => segs.join("/");
  const todo: Array<{ quot: SyncQuotation; dirs: string[][]; name: string }> = [];
  for (const quot of m.quotations) {
    // The PDF is rendered from the viewer, so only quotations the member can
    // open there get one. And, as with the Excel export, a quotation without
    // items has nothing to print.
    if (quot.canView !== true) continue;
    if (quotationExcelInputFromRow(quot.row).items.length === 0) continue;
    const name = `${quotationBase(quot)}.pdf`;
    const stale: string[][] = [];
    for (const segs of quotationDirs(quot)) {
      try {
        const current = await inDir(root, segs, async (dir) =>
          state.pdfs[`${quot.id}|${path(segs)}`] === quot.updatedAt &&
          (await localSize(dir, name)) !== null,
        );
        if (current) report.skipped++;
        else stale.push(segs);
      } catch (e) {
        report.errors.push(`⤓ ${path(segs)}/${name}: ${(e as Error).message}`);
      }
    }
    if (stale.length > 0) todo.push({ quot, dirs: stale, name });
  }
  if (todo.length === 0) return;

  const started = Date.now();
  let renderer: QuotationPdfRenderer | null = null;
  try {
    for (let i = 0; i < todo.length; i++) {
      if (Date.now() - started > PDF_BUDGET_MS) {
        report.pdfsPending = todo.length - i;
        break;
      }
      const { quot, dirs, name } = todo[i];
      opts.onProgress?.(`Making PDFs — ${i + 1} of ${todo.length} (${quot.ref})`);
      let bytes: Uint8Array;
      try {
        renderer ??= createQuotationPdfRenderer();
        bytes = (await renderer.render(quot.id)).bytes;
      } catch (e) {
        report.errors.push(`⤓ ${quot.ref}.pdf: ${(e as Error).message}`);
        continue;
      }
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      let wrote = false;
      for (const segs of dirs) {
        try {
          await inDir(root, segs, (dir) => writeFile(dir, name, blob));
          state.pdfs[`${quot.id}|${path(segs)}`] = quot.updatedAt;
          wrote = true;
        } catch (e) {
          report.errors.push(`⤓ ${path(segs)}/${name}: ${(e as Error).message}`);
        }
      }
      if (!wrote) continue;
      report.pdfs++;
      await writeState(root, state);
    }
  } finally {
    renderer?.dispose();
    opts.onProgress?.("");
  }
}
