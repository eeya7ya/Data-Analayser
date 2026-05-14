"use client";

import { useEffect, useState } from "react";

/**
 * Dashboard news bar. Renders nothing while loading and nothing if the
 * user has no active posts in their audience — the goal is "if there's
 * news, you see it; otherwise the dashboard isn't cluttered". Pinned
 * posts surface with a strong styling. Each post can be expanded to
 * reveal the full body; the headline is always visible.
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
}

export default function NewsBar() {
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

  if (!posts || posts.length === 0) return null;

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-2 mb-4">
      {posts.map((p) => (
        <article
          key={p.id}
          className={`rounded-xl border px-4 py-3 ${
            p.pinned
              ? "border-magic-red/40 bg-magic-red/5"
              : "border-magic-border bg-white"
          }`}
        >
          <button
            onClick={() => toggle(p.id)}
            className="w-full text-left flex items-start justify-between gap-3"
          >
            <div className="min-w-0">
              <h3 className="font-semibold text-magic-ink flex items-center gap-2">
                {p.pinned && (
                  <span
                    aria-label="pinned"
                    className="inline-block rounded-full bg-magic-red/15 text-magic-red px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                  >
                    Pinned
                  </span>
                )}
                {p.title}
              </h3>
              <div className="text-xs text-magic-ink/50 mt-0.5">
                {p.created_by_username && <>by @{p.created_by_username} · </>}
                {new Date(p.created_at).toLocaleDateString()}
                {p.expires_at && (
                  <>
                    {" · expires "}
                    {new Date(p.expires_at).toLocaleDateString()}
                  </>
                )}
              </div>
            </div>
            <span className="text-magic-ink/40 text-sm">
              {expanded.has(p.id) ? "−" : "+"}
            </span>
          </button>
          {expanded.has(p.id) && (
            <p className="mt-2 text-sm text-magic-ink/80 whitespace-pre-line">
              {p.body}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
