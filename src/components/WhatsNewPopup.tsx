"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Sparkles, X } from "@/lib/icons";
import type { NotificationItem } from "@/app/api/notifications/route";
import { RELEASE_NOTES } from "@/lib/releaseNotes";
import { APP_VERSION_LABEL } from "@/lib/version";
import { markNotificationRead } from "@/components/NotificationsBell";
import { renderBody } from "@/components/UpdatesFeed";
import { showcaseForTitle } from "@/components/releaseShowcases";

/**
 * One-time "What's new" popup for the current release.
 *
 * The newest release note is seeded into `news_posts` (see releaseNotes.ts),
 * so it already reaches every user as a bell message with a per-user read
 * state. This pops that message open the first time the user lands on any
 * page; closing it marks it read — server-side, so it never pops again on
 * any device and drops out of the bell — while it stays in /updates.
 */

// Every page mounts its own <TopBar/>; look the note up once per tab and share
// the answer across remounts.
let latestUnread: Promise<NotificationItem | null> | null = null;

function findLatestUnread(): Promise<NotificationItem | null> {
  const latest = RELEASE_NOTES[0];
  if (!latest) return Promise.resolve(null);
  latestUnread ??= fetch("/api/notifications", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then(
      (data: { items?: NotificationItem[] } | null) =>
        data?.items?.find(
          (i) =>
            i.id.startsWith("news:") && i.title === latest.title && !i.read,
        ) ?? null,
    )
    .catch(() => {
      latestUnread = null; // retry on the next page
      return null;
    });
  return latestUnread;
}

/** Called on logout so the next account in this tab is checked afresh. */
export function resetWhatsNew() {
  latestUnread = null;
}

export default function WhatsNewPopup() {
  const [note, setNote] = useState<NotificationItem | null>(null);
  // The visible part of the screen. On a phone a page that overflows sideways
  // widens the layout viewport past the screen, and a plain `fixed inset-0`
  // overlay would centre the dialog partly off-screen; pin it to what's visible.
  const [visible, setVisible] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void findLatestUnread().then((item) => {
      if (!cancelled) setNote(item);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!note || !vv) return;
    const update = () =>
      setVisible({
        left: vv.offsetLeft,
        top: vv.offsetTop,
        width: vv.width,
        height: vv.height,
      });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [note]);

  useEffect(() => {
    if (!note) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note]);

  if (!note) return null;
  const showcase = showcaseForTitle(note.title);

  function close() {
    if (!note) return;
    markNotificationRead(note.id);
    latestUnread = Promise.resolve(null);
    setNote(null);
  }

  // Portalled to <body>: the TopBar header's backdrop-blur would otherwise
  // become the containing block and trap this `fixed` overlay inside it.
  return createPortal(
    <div
      className="wn-fade no-print fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      style={visible ? { ...visible, right: "auto", bottom: "auto" } : undefined}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className={`wn-pop relative max-h-[85vh] w-full overflow-y-auto rounded-2xl border border-magic-border bg-white p-5 shadow-xl ${
          showcase ? "max-w-md" : "max-w-lg"
        }`}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-magic-ink/50 hover:bg-magic-soft hover:text-magic-ink"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-magic-red">
          <Sparkles className="h-3.5 w-3.5" />
          What&apos;s new · {APP_VERSION_LABEL}
        </div>
        <h2
          id="whats-new-title"
          className="mt-1 pr-8 text-lg font-semibold text-magic-ink"
        >
          {showcase?.headline ?? note.title}
        </h2>
        {showcase ? (
          <div className="mt-4">
            <showcase.Visual />
          </div>
        ) : (
          renderBody(note.body ?? "")
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Link
            href="/updates"
            onClick={close}
            className="rounded-md border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft"
          >
            All updates
          </Link>
          <button
            type="button"
            onClick={close}
            className="rounded-md bg-magic-red px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
