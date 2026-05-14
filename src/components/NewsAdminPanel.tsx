"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Admin → News tab. Lists every post (active + archived) and lets the
 * admin create / edit / archive. Archive is a soft action — the row
 * stays in the database and the toggle un-archives instantly.
 *
 * Audience is two checkbox grids: modules (all / crm / projects /
 * storage / admin) and roles (the catalogue from /api/admin/module-
 * roles). 'all' is the special wildcard tag — if it's checked nothing
 * else needs to be checked for that dimension.
 */

interface NewsPost {
  id: number;
  title: string;
  body: string;
  audience_modules: string[];
  audience_roles: string[];
  pinned: boolean;
  created_by_username: string | null;
  created_at: string;
  expires_at: string | null;
  deleted_at: string | null;
}

interface RoleCatalogue {
  [module: string]: readonly string[];
}

const MODULES = ["crm", "projects", "storage", "admin"];

export default function NewsAdminPanel() {
  const [posts, setPosts] = useState<NewsPost[] | null>(null);
  const [catalogue, setCatalogue] = useState<RoleCatalogue>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<NewsPost | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [news, mod] = await Promise.all([
        fetch("/api/news?include_archived=1", { cache: "no-store" }).then((r) =>
          r.json(),
        ),
        fetch("/api/admin/module-roles", { cache: "no-store" }).then((r) =>
          r.json(),
        ),
      ]);
      setPosts(news.posts ?? []);
      setCatalogue(mod.catalogue ?? {});
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save(payload: Partial<NewsPost> & { id?: number }) {
    setBusy(true);
    try {
      const isEdit = !!payload.id;
      const res = await fetch("/api/news", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setEditing(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive(id: number, archived: boolean) {
    if (
      archived &&
      !window.confirm(
        "Archive this announcement? It's soft — the row stays in the database and you can un-archive any time.",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch("/api/news", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, archived }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {editing === null ? (
        <button
          onClick={() =>
            setEditing({
              id: 0,
              title: "",
              body: "",
              audience_modules: ["all"],
              audience_roles: ["all"],
              pinned: false,
              created_by_username: null,
              created_at: "",
              expires_at: null,
              deleted_at: null,
            })
          }
          className="px-3 py-1.5 text-sm font-semibold rounded bg-magic-red text-white hover:bg-magic-red/90 transition-colors"
        >
          + New announcement
        </button>
      ) : (
        <NewsForm
          catalogue={catalogue}
          post={editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      )}

      {posts === null ? (
        <p className="text-sm text-magic-ink/60">Loading…</p>
      ) : posts.length === 0 ? (
        <p className="text-sm text-magic-ink/50 italic">
          No announcements yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {posts.map((p) => (
            <li
              key={p.id}
              className={`rounded-xl border bg-white p-3 ${
                p.deleted_at ? "border-magic-border/40 opacity-70" : "border-magic-border"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-magic-ink flex items-center gap-2">
                    {p.pinned && (
                      <span className="rounded-full bg-magic-red/15 text-magic-red px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                        Pinned
                      </span>
                    )}
                    {p.title}
                    {p.deleted_at && (
                      <span className="text-xs text-amber-700 font-normal">
                        · archived
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-magic-ink/80 mt-1 whitespace-pre-line line-clamp-3">
                    {p.body}
                  </p>
                  <div className="text-xs text-magic-ink/50 mt-1">
                    modules: {p.audience_modules.join(", ")} · roles:{" "}
                    {p.audience_roles.join(", ")}
                    {p.expires_at && (
                      <>
                        {" · expires "}
                        {new Date(p.expires_at).toLocaleDateString()}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setEditing(p)}
                    disabled={busy}
                    className="px-2 py-1 text-xs font-medium rounded border border-magic-border text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => void toggleArchive(p.id, !p.deleted_at)}
                    disabled={busy}
                    className="px-2 py-1 text-xs font-medium rounded border border-magic-border text-magic-ink/70 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300 disabled:opacity-50 transition-colors"
                  >
                    {p.deleted_at ? "Unarchive" : "Archive"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}

function NewsForm({
  post,
  catalogue,
  busy,
  onCancel,
  onSave,
}: {
  post: NewsPost;
  catalogue: RoleCatalogue;
  busy: boolean;
  onCancel: () => void;
  onSave: (payload: Partial<NewsPost> & { id?: number }) => Promise<void>;
}) {
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [modulesSel, setModulesSel] = useState<string[]>(post.audience_modules);
  const [rolesSel, setRolesSel] = useState<string[]>(post.audience_roles);
  const [pinned, setPinned] = useState(post.pinned);
  const [expiresAt, setExpiresAt] = useState(
    post.expires_at ? post.expires_at.slice(0, 10) : "",
  );

  function toggle(list: string[], value: string): string[] {
    return list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
  }

  const allRoles = Array.from(
    new Set(Object.values(catalogue).flat() as string[]),
  ).sort();

  return (
    <div className="rounded-xl border border-dashed border-magic-border bg-white p-4 space-y-3">
      <h3 className="font-semibold text-magic-ink">
        {post.id ? `Edit announcement #${post.id}` : "New announcement"}
      </h3>

      <input
        type="text"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={busy}
        className="w-full rounded border border-magic-border bg-white px-3 py-1.5 text-sm"
      />
      <textarea
        placeholder="Body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={busy}
        rows={4}
        className="w-full rounded border border-magic-border bg-white px-3 py-1.5 text-sm"
      />

      <div>
        <div className="text-xs font-semibold text-magic-ink/70 mb-1">
          Audience modules
        </div>
        <div className="flex flex-wrap gap-1.5">
          {["all", ...MODULES].map((m) => (
            <label
              key={m}
              className={`px-2 py-1 text-xs rounded border cursor-pointer ${
                modulesSel.includes(m)
                  ? "border-magic-red bg-magic-red/10 text-magic-red"
                  : "border-magic-border bg-white text-magic-ink/70 hover:bg-magic-soft"
              }`}
            >
              <input
                type="checkbox"
                checked={modulesSel.includes(m)}
                onChange={() => setModulesSel((s) => toggle(s, m))}
                className="hidden"
              />
              {m}
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-magic-ink/70 mb-1">
          Audience roles
        </div>
        <div className="flex flex-wrap gap-1.5">
          {["all", ...allRoles].map((r) => (
            <label
              key={r}
              className={`px-2 py-1 text-xs rounded border cursor-pointer ${
                rolesSel.includes(r)
                  ? "border-magic-red bg-magic-red/10 text-magic-red"
                  : "border-magic-border bg-white text-magic-ink/70 hover:bg-magic-soft"
              }`}
            >
              <input
                type="checkbox"
                checked={rolesSel.includes(r)}
                onChange={() => setRolesSel((s) => toggle(s, r))}
                className="hidden"
              />
              {r}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            disabled={busy}
          />
          Pinned
        </label>
        <label className="text-sm flex items-center gap-1.5">
          Expires:
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            disabled={busy}
            className="rounded border border-magic-border bg-white px-2 py-1 text-sm"
          />
        </label>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-semibold rounded border border-magic-border text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() =>
            void onSave({
              id: post.id || undefined,
              title,
              body,
              audience_modules: modulesSel.length > 0 ? modulesSel : ["all"],
              audience_roles: rolesSel.length > 0 ? rolesSel : ["all"],
              pinned,
              expires_at: expiresAt
                ? new Date(expiresAt).toISOString()
                : null,
            })
          }
          disabled={busy || !title.trim() || !body.trim()}
          className="px-3 py-1.5 text-xs font-semibold rounded bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
        >
          {post.id ? "Save" : "Publish"}
        </button>
      </div>
    </div>
  );
}
