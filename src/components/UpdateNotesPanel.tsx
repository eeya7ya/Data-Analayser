"use client";

import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";

/**
 * V1.3D — "Update notes" panel pinned to the bottom of the CRM hub. It
 * reuses the news feed (/api/news), which the server already filters to
 * the signed-in user's modules + roles — so each module only sees the
 * notes that target it. Pinned posts surface first; the body expands on
 * click. Unlike the dashboard NewsBar (which hides itself when empty),
 * this panel always renders with a friendly empty state because it's a
 * labelled section of the page.
 */

interface NewsPost {
  id: number;
  title: string;
  body: string;
  pinned: boolean;
  created_by_username: string | null;
  created_at: string;
}

export default function UpdateNotesPanel() {
  const [posts, setPosts] = useState<NewsPost[] | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/news", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { posts?: NewsPost[] }) => {
        if (!cancelled) setPosts(data.posts ?? []);
      })
      .catch(() => {
        if (!cancelled) setPosts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="rounded-2xl border border-magic-border bg-white/80 p-4 shadow-mt-soft">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-magic-red/10 text-magic-red">
          <Megaphone className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-bold text-magic-ink">Update notes</h2>
          <p className="text-xs text-magic-ink/50">
            What changed in your modules.
          </p>
        </div>
      </div>

      {posts === null ? (
        <p className="py-4 text-center text-xs text-magic-ink/40">Loading…</p>
      ) : posts.length === 0 ? (
        <p className="py-4 text-center text-xs text-magic-ink/40">
          No update notes for your modules yet.
        </p>
      ) : (
        <div className="space-y-2">
          {posts.map((p) => (
            <article
              key={p.id}
              className={`rounded-xl border px-3 py-2.5 ${
                p.pinned
                  ? "border-magic-red/40 bg-magic-red/5"
                  : "border-magic-border bg-white"
              }`}
            >
              <button
                onClick={() => toggle(p.id)}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-magic-ink">
                    {p.pinned && (
                      <span className="inline-block rounded-full bg-magic-red/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-magic-red">
                        New
                      </span>
                    )}
                    {p.title}
                  </h3>
                  <div className="mt-0.5 text-[11px] text-magic-ink/50">
                    {new Date(p.created_at).toLocaleDateString()}
                  </div>
                </div>
                <span className="text-sm text-magic-ink/40">
                  {expanded.has(p.id) ? "−" : "+"}
                </span>
              </button>
              {expanded.has(p.id) && (
                <p className="mt-2 whitespace-pre-line text-sm text-magic-ink/80">
                  {p.body}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
