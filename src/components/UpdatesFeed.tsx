"use client";

import { useEffect, useState } from "react";
import { Megaphone, Sparkles, Clock } from "@/lib/icons";
import { APP_VERSION_LABEL } from "@/lib/version";

/**
 * The dedicated /updates feed. Reuses /api/news, which the server already
 * filters to the signed-in user's modules + roles — so each person sees only
 * the notes that target them (a presales user never sees a sales-only note).
 *
 * Presentation is intentionally richer than the compact CRM-hub panel: a
 * version-stamped header, a timeline rail, parsed bullet bodies, and relative
 * dates, so the page reads like a proper product changelog.
 */

interface NewsPost {
  id: number;
  title: string;
  body: string;
  pinned: boolean;
  created_by_username: string | null;
  created_at: string;
}

function relativeDate(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())) /
      dayMs,
  );
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Split a note body into intro paragraphs and a bullet list. */
function renderBody(body: string) {
  const lines = body.split("\n");
  const blocks: Array<
    { kind: "p"; text: string } | { kind: "ul"; items: string[] }
  > = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("•") || line.startsWith("-")) {
      const item = line.replace(/^[•-]\s*/, "");
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "ul") last.items.push(item);
      else blocks.push({ kind: "ul", items: [item] });
    } else {
      blocks.push({ kind: "p", text: line });
    }
  }
  return (
    <div className="mt-2 space-y-2">
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i} className="text-sm leading-relaxed text-magic-ink/75">
            {b.text}
          </p>
        ) : (
          <ul key={i} className="space-y-1.5">
            {b.items.map((it, j) => {
              // Bold the lead-in label before an em-dash ("Feature — detail").
              const dash = it.indexOf("—");
              const label = dash > 0 ? it.slice(0, dash).trim() : null;
              const rest = dash > 0 ? it.slice(dash + 1).trim() : it;
              return (
                <li key={j} className="flex gap-2.5 text-sm text-magic-ink/75">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-magic-red/60" />
                  <span className="leading-relaxed">
                    {label && (
                      <span className="font-semibold text-magic-ink">
                        {label}
                        {" — "}
                      </span>
                    )}
                    {rest}
                  </span>
                </li>
              );
            })}
          </ul>
        ),
      )}
    </div>
  );
}

export default function UpdatesFeed() {
  const [posts, setPosts] = useState<NewsPost[] | null>(null);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="overflow-hidden rounded-2xl border border-magic-border bg-gradient-to-br from-magic-red/8 via-white to-white p-6 shadow-mt-soft">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-magic-red/10 text-magic-red">
              <Megaphone className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-magic-ink">
                Product updates
              </h1>
              <p className="mt-0.5 text-sm text-magic-ink/60">
                What changed in your modules — tailored to your role, newest
                first.
              </p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-magic-red/30 bg-white px-3 py-1.5 text-xs font-semibold text-magic-red shadow-sm">
            <Sparkles className="h-3.5 w-3.5" />
            {APP_VERSION_LABEL}
          </span>
        </div>
      </div>

      {/* Feed */}
      {posts === null ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-2xl border border-magic-border bg-white/60"
            />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-magic-border bg-white/70 px-6 py-14 text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-magic-soft text-magic-ink/40">
            <Clock className="h-6 w-6" />
          </span>
          <p className="mt-3 text-sm font-semibold text-magic-ink">
            You&apos;re all caught up
          </p>
          <p className="mt-1 text-sm text-magic-ink/55">
            No updates for your modules yet. New release notes will appear here.
          </p>
        </div>
      ) : (
        <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-magic-border/70">
          {posts.map((p) => (
            <li key={p.id} className="relative pl-10">
              {/* Timeline node */}
              <span
                className={`absolute left-0 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-white shadow-sm ${
                  p.pinned
                    ? "bg-magic-red text-white"
                    : "bg-magic-soft text-magic-ink/50"
                }`}
              >
                <Megaphone className="h-4 w-4" />
              </span>
              <article
                className={`rounded-2xl border bg-white p-5 shadow-mt-soft transition-shadow hover:shadow-mt-lift ${
                  p.pinned ? "border-magic-red/30" : "border-magic-border"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {p.pinned && (
                    <span className="inline-block rounded-full bg-magic-red/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-magic-red">
                      New
                    </span>
                  )}
                  <h2 className="text-base font-bold text-magic-ink">
                    {p.title}
                  </h2>
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-magic-ink/45">
                    <Clock className="h-3.5 w-3.5" />
                    {relativeDate(p.created_at)}
                  </span>
                </div>
                {renderBody(p.body)}
              </article>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
