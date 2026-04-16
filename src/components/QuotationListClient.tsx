"use client";

import { useState, useEffect, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import MoveToFolder from "@/components/MoveToFolder";
import DuplicateQuotation from "@/components/DuplicateQuotation";

/**
 * Robust fetch + JSON parse for our API routes. When a Vercel function
 * times out or a runtime crash escapes a route's try/catch, the response
 * body is a plain-text/HTML error page (starts with "An error occurred…").
 * Calling `.json()` on that throws `Unexpected token 'A'`, which is what
 * the user was seeing in the list view. This helper inspects the status
 * and content-type first and returns a `{ __error }` sentinel with a
 * human-readable message the UI can show cleanly.
 */
async function safeFetchJson<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T | { __error: string }> {
  let res: Response;
  try {
    // `no-store` on the client guarantees the browser HTTP cache can't
    // serve a stale pre-save response when the list refetches — the
    // /api/quotations route also sets `Cache-Control: private, no-store`
    // now, but this is the belt to that server-side suspenders.
    res = await fetch(url, { signal, cache: "no-store" });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { __error: "Request timed out — please retry." };
    }
    return { __error: (err as Error).message || "Network error" };
  }
  const raw = await res.text();
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    if (ct.includes("application/json")) {
      try {
        const parsed = JSON.parse(raw) as { error?: string };
        if (parsed?.error) return { __error: `${res.status}: ${parsed.error}` };
      } catch {
        /* fall through */
      }
    }
    const snippet = raw.trim().slice(0, 160) || res.statusText;
    return { __error: `${res.status} ${snippet}` };
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    const snippet = raw.trim().slice(0, 160);
    return { __error: `Non-JSON response from ${url}: ${snippet}` };
  }
}

interface Quotation {
  id: number;
  ref: string;
  project_name: string;
  client_name: string | null;
  site_name: string;
  folder_id: number | null;
  owner_id?: number | null;
  created_at: string;
  updated_at: string;
  // Admin-only fields populated by a join on users.
  owner_username?: string | null;
  owner_display_name?: string | null;
}

interface Folder {
  id: number;
  name: string;
  owner_id?: number | null;
  created_at: string;
  updated_at: string;
  // CRM fields (a folder is a client record).
  client_email?: string | null;
  client_phone?: string | null;
  client_company?: string | null;
  // Admin-only fields populated by a join on users.
  owner_username?: string | null;
  owner_display_name?: string | null;
}

/**
 * Folders created before the "name required" validation could slip into the
 * database with an empty or whitespace-only name. When that happens the
 * folder bar ends up rendering just an owner badge with no visible label,
 * which is extremely confusing — the user thinks a quotation count of 0
 * means their data is gone when really the row just has no title. This
 * helper keeps the list readable by always showing *something*.
 */
function folderDisplayName(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  return trimmed || "(untitled client)";
}

function formatDateTime(dt: string) {
  const d = new Date(dt);
  const date = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return { date, time };
}

export default function QuotationListClient({
  isAdmin,
  initialQuotations,
  initialFolders,
}: {
  isAdmin: boolean;
  /**
   * Server-rendered initial data. When provided, the component mounts with
   * the real rows already in state and skips the initial `/api/quotations`
   * + `/api/folders` round-trip entirely — killing the skeleton flash on
   * cold starts.
   */
  initialQuotations?: Array<Record<string, unknown>>;
  initialFolders?: Array<Record<string, unknown>>;
}) {
  const router = useRouter();

  // ── Row navigation pending state ─────────────────────────────────────
  // router.push() on its own gives no visual feedback at all: the user
  // clicks a row, nothing visibly happens for however long the server
  // takes to render /quotation?id=<n>, and they conclude the app is
  // broken. Wrapping the push in useTransition lets us dim the row that
  // was clicked *on the very next frame*, and Next.js's loading.tsx
  // boundary takes over from there.
  const [, startNavigation] = useTransition();
  const [openingId, setOpeningId] = useState<number | null>(null);

  // ── Data loaded client-side (or hydrated from the server page) ───
  const hasInitial =
    Array.isArray(initialQuotations) && Array.isArray(initialFolders);
  const [quotations, setQuotations] = useState<Quotation[]>(
    () => (initialQuotations as Quotation[] | undefined) || [],
  );
  const [folders, setFolders] = useState<Folder[]>(
    () => (initialFolders as Folder[] | undefined) || [],
  );
  const [dataLoading, setDataLoading] = useState(!hasInitial);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    // The server page already handed us the full dataset on first paint.
    // Skip the client fetch entirely — unless the user explicitly hit
    // retry after an error (reloadTick > 0).
    if (hasInitial && reloadTick === 0) return;
    let cancelled = false;
    setDataLoading(true);
    setLoadError(null);
    const ctl = new AbortController();
    // 15 s gives Supabase enough time to respond on a cold start while
    // still giving the user a prompt error instead of a 25 s dead wait.
    // If the DB is genuinely hung the user sees the Retry button in 15 s
    // instead of 25 s; a warm connection responds in < 1 s anyway.
    const timer = window.setTimeout(() => ctl.abort(), 15_000);
    Promise.all([
      safeFetchJson<{ quotations?: Quotation[] }>(
        "/api/quotations",
        ctl.signal,
      ),
      safeFetchJson<{ folders?: Folder[] }>("/api/folders", ctl.signal),
    ])
      .then(([qRes, fRes]) => {
        if (cancelled) return;
        if ("__error" in qRes) {
          setLoadError(qRes.__error);
          return;
        }
        if ("__error" in fRes) {
          setLoadError(fRes.__error);
          return;
        }
        setQuotations((qRes.quotations || []) as Quotation[]);
        setFolders((fRes.folders || []) as Folder[]);
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (!cancelled) setDataLoading(false);
      });
    return () => {
      cancelled = true;
      ctl.abort();
      window.clearTimeout(timer);
    };
  }, [hasInitial, reloadTick]);

  // ── Search ────────────────────────────────────────────────────────────
  // Two independent searches: one on the main card grid (filters clients by
  // name / email / phone / company) and one inside the detail view of a
  // selected client (filters quotations by ref / project / client / site).
  // They deliberately don't share state so flipping between views doesn't
  // clobber whatever the user was typing in the other one.
  const [clientSearch, setClientSearch] = useState("");
  const [debouncedClientSearch, setDebouncedClientSearch] = useState("");
  const [quotationSearch, setQuotationSearch] = useState("");
  const [debouncedQuotationSearch, setDebouncedQuotationSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedClientSearch(clientSearch), 350);
    return () => clearTimeout(t);
  }, [clientSearch]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuotationSearch(quotationSearch), 350);
    return () => clearTimeout(t);
  }, [quotationSearch]);

  // ── Selected client (detail-view) ────────────────────────────────────
  // When non-null, we switch from the card grid to a per-client detail
  // view. The key matches the `groups` entries (e.g. "42", "unfiled",
  // "unfiled-7" for admin buckets).
  const [selectedClientKey, setSelectedClientKey] = useState<string | null>(
    null,
  );

  // ── Admin-only: per-user subtab ──────────────────────────────────────
  // Admins see quotations from every user in the org, which can explode
  // to hundreds of cards. We break them into one subtab per owning user
  // (plus an "All users" meta-tab) so the grid stays scannable. The tab
  // state is intentionally client-only — refreshing the page resets to
  // "All users", which matches the old (single-list) behavior.
  const [adminUserTab, setAdminUserTab] = useState<string>("__all");

  // Reset the per-quotation search whenever the user enters / leaves a
  // client card. Otherwise a stale query sneaks in from a previous client.
  useEffect(() => {
    setQuotationSearch("");
    setDebouncedQuotationSearch("");
  }, [selectedClientKey]);

  // ── Client-folder CRUD state (folder == client record) ──────────────
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deletingQuotationId, setDeletingQuotationId] = useState<number | null>(null);
  const [error, setError] = useState("");

  // ── Grouping ─────────────────────────────────────────────────────────
  // Always compute the full grouping — no search filtering here. Both the
  // card grid (client-level search) and the detail view (quotation-level
  // search) derive their rows from this stable base list so switching
  // between searches never discards rows the user expected to see.
  interface Group {
    key: string;
    folderId: number | null;
    folder: Folder | null;
    items: Quotation[];
    unfiledOwnerLabel?: string | null;
  }

  const groups = useMemo<Group[]>(() => {
    const byFolder = new Map<number | null, Quotation[]>();
    for (const r of quotations) {
      const key = r.folder_id;
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key)!.push(r);
    }

    const result: Group[] = [];

    // Named folders — already sorted server-side.
    for (const f of folders) {
      const items = byFolder.get(f.id) || [];
      result.push({ key: String(f.id), folderId: f.id, folder: f, items });
    }

    // Unfiled section(s).
    const unfiled = byFolder.get(null) || [];
    if (!isAdmin) {
      result.push({
        key: "unfiled",
        folderId: null,
        folder: null,
        items: unfiled,
      });
    } else {
      // Admin: one unfiled bucket per owning user so the UI stays readable
      // across the whole org.
      const perOwner = new Map<number | null, Quotation[]>();
      for (const r of unfiled) {
        const ownerKey = r.owner_id ?? null;
        if (!perOwner.has(ownerKey)) perOwner.set(ownerKey, []);
        perOwner.get(ownerKey)!.push(r);
      }
      const sortedOwners = [...perOwner.entries()].sort(([aKey, aArr], [bKey, bArr]) => {
        const aLabel =
          aArr[0]?.owner_display_name?.trim() ||
          aArr[0]?.owner_username ||
          (aKey === null ? "—" : `user#${aKey}`);
        const bLabel =
          bArr[0]?.owner_display_name?.trim() ||
          bArr[0]?.owner_username ||
          (bKey === null ? "—" : `user#${bKey}`);
        return aLabel.localeCompare(bLabel);
      });
      for (const [ownerKey, items] of sortedOwners) {
        const label =
          items[0]?.owner_display_name?.trim() ||
          items[0]?.owner_username ||
          null;
        result.push({
          key: `unfiled-${ownerKey ?? "null"}`,
          folderId: null,
          folder: null,
          items,
          unfiledOwnerLabel: label,
        });
      }
      if (sortedOwners.length === 0) {
        result.push({
          key: "unfiled",
          folderId: null,
          folder: null,
          items: [],
        });
      }
    }

    return result;
  }, [quotations, folders, isAdmin]);

  // Admin: derive the ordered list of user-subtabs from the currently
  // visible groups (so it reflects real data — not every user on the
  // team). Each bucket key is the owning user's id (stringified); label
  // falls back to display_name → username → "user#<id>" → "Unknown".
  const adminUserTabs = useMemo<
    Array<{ key: string; label: string; count: number }>
  >(() => {
    if (!isAdmin) return [];
    const byOwner = new Map<string, { label: string; count: number }>();
    function ownerKey(
      ownerId: number | null | undefined,
      username: string | null | undefined,
    ): string {
      if (ownerId != null) return String(ownerId);
      if (username) return `u:${username}`;
      return "__none";
    }
    function ownerLabel(
      display: string | null | undefined,
      username: string | null | undefined,
      ownerId: number | null | undefined,
    ): string {
      return (
        (display && display.trim()) ||
        (username && username.trim()) ||
        (ownerId != null ? `user#${ownerId}` : "Unassigned")
      );
    }
    for (const f of folders) {
      const k = ownerKey(f.owner_id, f.owner_username);
      const l = ownerLabel(f.owner_display_name, f.owner_username, f.owner_id);
      const prev = byOwner.get(k) ?? { label: l, count: 0 };
      byOwner.set(k, { label: l, count: prev.count + 1 });
    }
    for (const r of quotations) {
      if (r.folder_id != null) continue;
      const k = ownerKey(r.owner_id, r.owner_username);
      const l = ownerLabel(r.owner_display_name, r.owner_username, r.owner_id);
      const prev = byOwner.get(k) ?? { label: l, count: 0 };
      byOwner.set(k, { label: l, count: prev.count + 1 });
    }
    return [...byOwner.entries()]
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [isAdmin, folders, quotations]);

  // Clamp the active user-tab to something still present — if the admin
  // deletes a user (or all their folders/quotations), snap back to "All".
  useEffect(() => {
    if (!isAdmin) return;
    if (adminUserTab === "__all") return;
    if (!adminUserTabs.some((t) => t.key === adminUserTab)) {
      setAdminUserTab("__all");
    }
  }, [isAdmin, adminUserTab, adminUserTabs]);

  // Client-level filtering for the card grid. Searches by folder name,
  // email, phone, or company — and as a convenience also matches any
  // quotation field inside the folder, so the user can locate a client
  // via something they only remember about its quotations.
  // Admin subtab pre-filter: narrow the group list to the currently
  // selected user before the text search runs on top.
  const userScopedGroups = useMemo<Group[]>(() => {
    if (!isAdmin || adminUserTab === "__all") return groups;
    return groups.filter((g) => {
      const ownerId =
        g.folder?.owner_id ??
        (g.items[0]?.owner_id as number | null | undefined) ??
        null;
      const ownerUsername =
        g.folder?.owner_username ??
        (g.items[0]?.owner_username as string | null | undefined) ??
        null;
      const key =
        ownerId != null
          ? String(ownerId)
          : ownerUsername
            ? `u:${ownerUsername}`
            : "__none";
      return key === adminUserTab;
    });
  }, [isAdmin, adminUserTab, groups]);

  const filteredGroups = useMemo<Group[]>(() => {
    const base = userScopedGroups;
    const q = debouncedClientSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((g) => {
      if (g.folder) {
        const f = g.folder;
        if ((f.name || "").toLowerCase().includes(q)) return true;
        if ((f.client_email || "").toLowerCase().includes(q)) return true;
        if ((f.client_phone || "").toLowerCase().includes(q)) return true;
        if ((f.client_company || "").toLowerCase().includes(q)) return true;
      } else if ("unfiled".includes(q)) {
        return true;
      }
      // Also match if any contained quotation matches — lets users
      // land on the right client by typing a ref or project name.
      return g.items.some(
        (r) =>
          r.ref.toLowerCase().includes(q) ||
          r.project_name.toLowerCase().includes(q) ||
          (r.client_name && r.client_name.toLowerCase().includes(q)) ||
          r.site_name.toLowerCase().includes(q),
      );
    });
  }, [userScopedGroups, debouncedClientSearch]);

  // Currently selected client (detail view), resolved against the group
  // list so edits / reloads stay in sync.
  const selectedGroup = useMemo<Group | null>(() => {
    if (!selectedClientKey) return null;
    return groups.find((g) => g.key === selectedClientKey) || null;
  }, [groups, selectedClientKey]);

  // If the selected client disappears (deleted, soft-trashed, or the
  // admin owner switched users), bounce back to the grid view so we
  // never render a broken "phantom" detail header.
  useEffect(() => {
    if (selectedClientKey && !selectedGroup) {
      setSelectedClientKey(null);
    }
  }, [selectedClientKey, selectedGroup]);

  // Quotations shown inside the detail view, filtered by the per-client
  // search box.
  const selectedQuotations = useMemo<Quotation[]>(() => {
    if (!selectedGroup) return [];
    const q = debouncedQuotationSearch.trim().toLowerCase();
    if (!q) return selectedGroup.items;
    return selectedGroup.items.filter(
      (r) =>
        r.ref.toLowerCase().includes(q) ||
        r.project_name.toLowerCase().includes(q) ||
        (r.client_name && r.client_name.toLowerCase().includes(q)) ||
        r.site_name.toLowerCase().includes(q),
    );
  }, [selectedGroup, debouncedQuotationSearch]);

  const foldersForMove = useMemo(
    () => folders.map((f) => ({ id: f.id, name: f.name })),
    [folders],
  );

  // Client-side folder sort that mirrors the admin server query
  // (`order by u.username nulls first, f.name asc`). Regular users get the
  // simpler name-only sort. Without this, optimistic updates after create /
  // edit would fall back to plain `name.localeCompare`, jumbling a
  // multi-user admin list where folders from different owners share a name
  // (or have empty names, which sort identically).
  function sortFolders(list: Folder[]): Folder[] {
    return [...list].sort((a, b) => {
      if (isAdmin) {
        const au = (a.owner_username || "").toLowerCase();
        const bu = (b.owner_username || "").toLowerCase();
        if (au !== bu) {
          if (!au) return -1;
          if (!bu) return 1;
          return au.localeCompare(bu);
        }
      }
      return (a.name || "").localeCompare(b.name || "");
    });
  }

  // ── Client/folder CRUD handlers ──────────────────────────────────────
  async function createFolder() {
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          client_email: newEmail.trim() || null,
          client_phone: newPhone.trim() || null,
          client_company: newCompany.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create client");
        return;
      }
      setFolders((prev) => sortFolders([...prev, data.folder]));
      // Auto-open the newly-created client's detail view so the user lands
      // right on the "empty quotations" screen they can start filling in.
      setSelectedClientKey(String(data.folder.id));
      setNewName("");
      setNewEmail("");
      setNewPhone("");
      setNewCompany("");
      setShowCreate(false);
    } finally {
      setCreating(false);
    }
  }

  /** Save CRM edits (name + email/phone/company) for an existing client. */
  async function saveFolderEdit(id: number) {
    if (!editName.trim()) return;
    setRenaming(true);
    setError("");
    try {
      const res = await fetch(`/api/folders?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          client_email: editEmail.trim() || null,
          client_phone: editPhone.trim() || null,
          client_company: editCompany.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update client");
        return;
      }
      setFolders((prev) =>
        sortFolders(prev.map((f) => (f.id === id ? data.folder : f))),
      );
      setEditingId(null);
      setEditName("");
      setEditEmail("");
      setEditPhone("");
      setEditCompany("");
    } finally {
      setRenaming(false);
    }
  }

  async function deleteFolder(id: number) {
    if (
      !confirm(
        "Move this client and all of its quotations to the Trash? They can be restored from the Trash tab later.",
      )
    )
      return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/folders?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setFolders((prev) => prev.filter((f) => f.id !== id));
        // The server cascade-soft-deleted the folder's quotations too; drop
        // them from local state so the UI updates without a reload.
        setQuotations((prev) => prev.filter((r) => r.folder_id !== id));
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to move client to trash");
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function deleteQuotation(id: number) {
    if (!confirm("Move this quotation to the Trash? It can be restored later."))
      return;
    setDeletingQuotationId(id);
    try {
      const res = await fetch(`/api/quotations?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setQuotations((prev) => prev.filter((r) => r.id !== id));
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to move quotation to trash");
      }
    } finally {
      setDeletingQuotationId(null);
    }
  }

  // ── Render helpers ───────────────────────────────────────────────────
  function renderClientCard(g: Group) {
    const isUnfiled = g.folderId === null;
    const title = isUnfiled
      ? "Unfiled"
      : folderDisplayName(g.folder!.name);
    const ownerLabel = isUnfiled
      ? g.unfiledOwnerLabel
      : g.folder?.owner_display_name?.trim() || g.folder?.owner_username || null;

    return (
      <button
        key={g.key}
        type="button"
        onClick={() => setSelectedClientKey(g.key)}
        className="group text-left rounded-2xl border border-magic-border bg-white hover:border-magic-red/60 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-magic-red/30 transition-all overflow-hidden flex flex-col"
      >
        {/* Card header strip */}
        <div className="p-3 bg-magic-header flex items-center gap-2">
          <svg
            className="w-5 h-5 text-magic-ink/50 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
          <div className="flex-1 min-w-0">
            <div
              className={`font-semibold truncate ${
                !isUnfiled && !g.folder!.name?.trim()
                  ? "text-magic-ink/40 italic"
                  : "text-magic-ink"
              }`}
            >
              {title}
            </div>
            {isAdmin && ownerLabel && (
              <span className="inline-flex items-center gap-1 rounded-full bg-magic-red/10 text-magic-red text-[10px] font-semibold px-2 py-0.5 uppercase tracking-wide mt-0.5">
                @{ownerLabel}
              </span>
            )}
          </div>
          <svg
            className="w-4 h-4 text-magic-ink/30 group-hover:text-magic-red transition-colors shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </div>

        {/* Card body */}
        <div className="p-3 flex-1 flex flex-col gap-1.5">
          <div className="text-xs text-magic-ink/50">
            {g.items.length} quotation{g.items.length !== 1 ? "s" : ""}
          </div>
          {!isUnfiled && g.folder && (
            <div className="text-[11px] text-magic-ink/70 space-y-0.5">
              {g.folder.client_company && (
                <div className="italic truncate">{g.folder.client_company}</div>
              )}
              {g.folder.client_email && (
                <div className="truncate">{g.folder.client_email}</div>
              )}
              {g.folder.client_phone && (
                <div className="truncate">{g.folder.client_phone}</div>
              )}
              {!g.folder.client_company &&
                !g.folder.client_email &&
                !g.folder.client_phone && (
                  <div className="text-magic-ink/30">No contact info yet</div>
                )}
            </div>
          )}
          {isUnfiled && (
            <div className="text-[11px] text-magic-ink/40">
              Quotations not yet assigned to a client
            </div>
          )}
        </div>
      </button>
    );
  }

  function renderDetailView(g: Group) {
    const isUnfiled = g.folderId === null;
    const isEditing = editingId === g.folderId && !isUnfiled;
    const hasInnerSearch = debouncedQuotationSearch.trim().length > 0;

    return (
      <div>
        {/* Back + breadcrumb */}
        <button
          type="button"
          onClick={() => setSelectedClientKey(null)}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-magic-ink/60 hover:text-magic-red transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to all clients
        </button>

        {/* Client header / editor */}
        <div className="rounded-2xl border border-magic-border bg-white overflow-hidden">
          <div className="p-4 bg-magic-header flex items-start gap-3 flex-wrap">
            <svg
              className="w-6 h-6 text-magic-ink/50 shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>

            {isEditing ? (
              <div className="flex-1 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveFolderEdit(g.folderId!);
                    if (e.key === "Escape") {
                      setEditingId(null);
                      setEditName("");
                      setError("");
                    }
                  }}
                  autoFocus
                  placeholder="Client name *"
                  className="flex-1 min-w-[180px] px-3 py-1.5 text-sm border border-magic-border rounded-lg focus:outline-none focus:ring-2 focus:ring-magic-red/30"
                />
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="Email"
                  className="flex-1 min-w-[180px] px-3 py-1.5 text-sm border border-magic-border rounded-lg focus:outline-none focus:ring-2 focus:ring-magic-red/30"
                />
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="Phone"
                  className="flex-1 min-w-[150px] px-3 py-1.5 text-sm border border-magic-border rounded-lg focus:outline-none focus:ring-2 focus:ring-magic-red/30"
                />
                <input
                  type="text"
                  value={editCompany}
                  onChange={(e) => setEditCompany(e.target.value)}
                  placeholder="Company"
                  className="flex-1 min-w-[180px] px-3 py-1.5 text-sm border border-magic-border rounded-lg focus:outline-none focus:ring-2 focus:ring-magic-red/30"
                />
                <button
                  onClick={() => saveFolderEdit(g.folderId!)}
                  disabled={renaming || !editName.trim()}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50"
                >
                  {renaming ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => {
                    setEditingId(null);
                    setEditName("");
                    setEditEmail("");
                    setEditPhone("");
                    setEditCompany("");
                    setError("");
                  }}
                  className="px-3 py-1.5 text-xs text-magic-ink/60 hover:text-magic-ink"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2
                    className={`text-lg font-semibold ${
                      !isUnfiled && !g.folder!.name?.trim()
                        ? "text-magic-ink/40 italic"
                        : "text-magic-ink"
                    }`}
                  >
                    {isUnfiled ? "Unfiled" : folderDisplayName(g.folder!.name)}
                  </h2>
                  {isAdmin &&
                    (g.folder?.owner_username || g.unfiledOwnerLabel) && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-magic-red/10 text-magic-red text-[10px] font-semibold px-2 py-0.5 uppercase tracking-wide">
                        @
                        {g.folder?.owner_display_name?.trim() ||
                          g.folder?.owner_username ||
                          g.unfiledOwnerLabel}
                      </span>
                    )}
                </div>
                {!isUnfiled && g.folder && (
                  <div className="mt-1 text-[12px] text-magic-ink/70 flex flex-wrap gap-x-4 gap-y-0.5">
                    {g.folder.client_company && (
                      <span className="italic">{g.folder.client_company}</span>
                    )}
                    {g.folder.client_email && (
                      <span>{g.folder.client_email}</span>
                    )}
                    {g.folder.client_phone && (
                      <span>{g.folder.client_phone}</span>
                    )}
                    {!g.folder.client_company &&
                      !g.folder.client_email &&
                      !g.folder.client_phone && (
                        <span className="text-magic-ink/30">
                          No contact info yet — click Edit to add some
                        </span>
                      )}
                  </div>
                )}
                <div className="mt-1 text-xs text-magic-ink/50">
                  {g.items.length} quotation{g.items.length !== 1 ? "s" : ""}
                </div>
              </div>
            )}

            {!isUnfiled && !isEditing && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => {
                    setEditingId(g.folderId);
                    setEditName(g.folder!.name);
                    setEditEmail(g.folder!.client_email || "");
                    setEditPhone(g.folder!.client_phone || "");
                    setEditCompany(g.folder!.client_company || "");
                    setError("");
                  }}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-magic-border bg-white text-magic-ink hover:border-magic-red/60 hover:text-magic-red transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteFolder(g.folderId!)}
                  disabled={deletingId === g.folderId}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 bg-white text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  {deletingId === g.folderId ? "Moving…" : "Trash"}
                </button>
              </div>
            )}
          </div>

          {/* In-client search + new quotation */}
          <div className="p-3 border-t border-magic-border flex items-center gap-3">
            <div className="relative flex-1">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-magic-ink/40"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={quotationSearch}
                onChange={(e) => setQuotationSearch(e.target.value)}
                placeholder="Search this client's quotations by ref, project, or site…"
                className="w-full pl-10 pr-4 py-2 text-sm border border-magic-border rounded-xl focus:outline-none focus:ring-2 focus:ring-magic-red/30 bg-white"
              />
              {quotationSearch && (
                <button
                  onClick={() => setQuotationSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-magic-ink/40 hover:text-magic-ink"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>
            {!isUnfiled && (
              <Link
                href={`/designer?folder=${g.folderId}`}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl bg-magic-red text-white hover:bg-magic-red/90 transition-colors whitespace-nowrap"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                New quotation
              </Link>
            )}
          </div>

          {/* Quotation table */}
          {selectedQuotations.length === 0 ? (
            <div className="p-6 text-sm text-magic-ink/40 text-center border-t border-magic-border">
              {hasInnerSearch
                ? "No quotations match your search."
                : "No quotations in this folder."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-magic-red text-xs uppercase bg-magic-soft/20 border-t border-magic-border">
                <tr>
                  <th className="p-3 text-left">Ref</th>
                  <th className="p-3 text-left">Project</th>
                  <th className="p-3 text-left">Client</th>
                  <th className="p-3 text-left">Site</th>
                  <th className="p-3 text-left">Created</th>
                  <th className="p-3 text-left">Last Edited</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {selectedQuotations.map((r) => {
                  const created = formatDateTime(r.created_at);
                  const updated = formatDateTime(r.updated_at);
                  const wasEdited = r.updated_at !== r.created_at;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => {
                        setOpeningId(r.id);
                        startNavigation(() =>
                          router.push(`/quotation?id=${r.id}`),
                        );
                      }}
                      aria-busy={openingId === r.id}
                      className={`border-t border-magic-border cursor-pointer transition-colors ${
                        openingId === r.id
                          ? "bg-magic-soft/40 opacity-70"
                          : "hover:bg-magic-soft/10"
                      }`}
                    >
                      <td className="p-3 font-mono">
                        <Link
                          href={`/quotation?id=${r.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-magic-red hover:underline"
                        >
                          {r.ref}
                        </Link>
                      </td>
                      <td className="p-3">{r.project_name}</td>
                      <td className="p-3">{r.client_name || "—"}</td>
                      <td className="p-3">{r.site_name}</td>
                      <td className="p-3 text-xs text-magic-ink/60">
                        <div>{created.date}</div>
                        <div className="text-magic-ink/40">{created.time}</div>
                      </td>
                      <td className="p-3 text-xs text-magic-ink/60">
                        {wasEdited ? (
                          <>
                            <div>{updated.date}</div>
                            <div className="text-magic-ink/40">
                              {updated.time}
                            </div>
                          </>
                        ) : (
                          <span className="text-magic-ink/30">—</span>
                        )}
                      </td>
                      <td
                        className="p-3 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-3">
                          <DuplicateQuotation
                            quotationId={r.id}
                            currentFolderId={r.folder_id}
                            folders={foldersForMove}
                          />
                          <MoveToFolder
                            quotationId={r.id}
                            currentFolderId={r.folder_id}
                            folders={foldersForMove}
                          />
                          <button
                            onClick={() => deleteQuotation(r.id)}
                            disabled={deletingQuotationId === r.id}
                            title="Move to trash"
                            className="text-xs text-red-500 hover:underline disabled:opacity-50"
                          >
                            {deletingQuotationId === r.id ? "Moving…" : "Trash"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────
  const showEmptyState =
    !dataLoading &&
    !loadError &&
    quotations.length === 0 &&
    folders.length === 0;

  return (
    <div>
      {/* Error banner (CRUD errors) */}
      {error && (
        <div className="mb-4 px-4 py-2 text-sm text-red-600 bg-red-50 rounded-xl border border-red-200">
          {error}
        </div>
      )}

      {/* Load error */}
      {loadError && (
        <div className="mb-4 px-4 py-3 text-sm text-red-600 bg-red-50 rounded-xl border border-red-200 flex items-start justify-between gap-3">
          <div className="min-w-0 break-words">
            <div className="font-semibold">Failed to load quotations.</div>
            <div className="text-xs text-red-600/80">{loadError}</div>
          </div>
          <button
            onClick={() => setReloadTick((t) => t + 1)}
            className="shrink-0 rounded-md bg-magic-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {dataLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
            <div
              key={i}
              className="h-28 rounded-2xl border border-magic-border bg-white animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Empty state — no clients AND no quotations */}
      {showEmptyState && (
        <div className="rounded-2xl border border-magic-border bg-white p-6 text-center text-magic-ink/50">
          <div>
            No clients yet. Click{" "}
            <strong className="text-magic-red">+ New Client</strong> below to
            add one, or go to{" "}
            <a href="/designer" className="text-magic-red underline">
              the Designer
            </a>{" "}
            to create a quotation.
          </div>
          <div className="mt-2 text-xs">
            Missing a client or quotation you know you saved? Check the{" "}
            <strong className="text-magic-red">Trash</strong> tab above —
            deleted items can be restored from there.
          </div>
        </div>
      )}

      {/* ─── Detail view (a client is selected) ─── */}
      {!dataLoading && selectedGroup && renderDetailView(selectedGroup)}

      {/* ─── Grid view (default) ─── */}
      {!dataLoading && !selectedGroup && (
        <>
          {/* Admin-only: one subtab per owning user so the card grid
              doesn't scroll for days on larger teams. "All users" keeps
              the pre-subtab behavior one click away. */}
          {isAdmin && adminUserTabs.length > 0 && (
            <div className="mb-4 -mx-1 flex flex-wrap items-center gap-1.5 overflow-x-auto rounded-2xl border border-magic-border bg-white/70 p-1.5 shadow-mt-soft backdrop-blur">
              <button
                type="button"
                onClick={() => setAdminUserTab("__all")}
                className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                  adminUserTab === "__all"
                    ? "bg-gradient-to-r from-magic-red to-magic-accent text-white shadow-sm"
                    : "text-magic-ink/70 hover:bg-magic-soft"
                }`}
              >
                All users
                <span className="ml-1.5 rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-bold">
                  {adminUserTabs.reduce((a, t) => a + t.count, 0)}
                </span>
              </button>
              {adminUserTabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setAdminUserTab(t.key)}
                  className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                    adminUserTab === t.key
                      ? "bg-gradient-to-r from-magic-red to-magic-accent text-white shadow-sm"
                      : "text-magic-ink/70 hover:bg-magic-soft"
                  }`}
                  title={`${t.label} · ${t.count} client${t.count !== 1 ? "s" : ""}`}
                >
                  @{t.label}
                  <span
                    className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                      adminUserTab === t.key
                        ? "bg-black/20"
                        : "bg-magic-red/10 text-magic-red"
                    }`}
                  >
                    {t.count}
                  </span>
                </button>
              ))}
            </div>
          )}
          {/* Top bar: client search + new client */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-magic-ink/40"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Search clients by name, email, phone, or company…"
                className="w-full pl-10 pr-4 py-2 text-sm border border-magic-border rounded-xl focus:outline-none focus:ring-2 focus:ring-magic-red/30 bg-white"
              />
              {clientSearch && (
                <button
                  onClick={() => setClientSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-magic-ink/40 hover:text-magic-ink"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>
            <button
              onClick={() => {
                setShowCreate(!showCreate);
                setError("");
              }}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl bg-magic-red text-white hover:bg-magic-red/90 transition-colors whitespace-nowrap"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4v16m8-8H4"
                />
              </svg>
              New Client
            </button>
          </div>

          {/* Create client form */}
          {showCreate && (
            <div className="mb-4 p-3 rounded-xl border border-magic-border bg-white">
              <div className="flex flex-wrap items-start gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createFolder()}
                  placeholder="Client name *"
                  autoFocus
                  className="flex-1 min-w-[180px] px-3 py-1.5 text-sm border border-magic-border rounded-lg focus:outline-none focus:ring-2 focus:ring-magic-red/30"
                />
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="Email"
                  className="flex-1 min-w-[180px] px-3 py-1.5 text-sm border border-magic-border rounded-lg focus:outline-none focus:ring-2 focus:ring-magic-red/30"
                />
                <input
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="Phone"
                  className="flex-1 min-w-[150px] px-3 py-1.5 text-sm border border-magic-border rounded-lg focus:outline-none focus:ring-2 focus:ring-magic-red/30"
                />
                <input
                  type="text"
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  placeholder="Company"
                  className="flex-1 min-w-[180px] px-3 py-1.5 text-sm border border-magic-border rounded-lg focus:outline-none focus:ring-2 focus:ring-magic-red/30"
                />
                <button
                  onClick={createFolder}
                  disabled={creating || !newName.trim()}
                  className="px-4 py-1.5 text-sm font-medium rounded-lg bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
                >
                  {creating ? "Creating…" : "Create"}
                </button>
                <button
                  onClick={() => {
                    setShowCreate(false);
                    setNewName("");
                    setNewEmail("");
                    setNewPhone("");
                    setNewCompany("");
                    setError("");
                  }}
                  className="px-3 py-1.5 text-sm text-magic-ink/60 hover:text-magic-ink transition-colors"
                >
                  Cancel
                </button>
              </div>
              <p className="mt-2 text-[11px] text-magic-ink/50">
                Clients are reused across quotations — typing their info once
                here means it auto-fills on every future quotation you create
                for them.
              </p>
            </div>
          )}

          {/* Search summary */}
          {debouncedClientSearch.trim() && (
            <div className="mb-3 text-sm text-magic-ink/50">
              {filteredGroups.length} client
              {filteredGroups.length !== 1 ? "s" : ""} match &ldquo;
              {debouncedClientSearch}&rdquo;
            </div>
          )}

          {/* Card grid */}
          {filteredGroups.length === 0 ? (
            !showEmptyState && (
              <div className="rounded-2xl border border-magic-border bg-white p-6 text-center text-magic-ink/50">
                No clients match your search.
              </div>
            )
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {filteredGroups.map((g) => renderClientCard(g))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
