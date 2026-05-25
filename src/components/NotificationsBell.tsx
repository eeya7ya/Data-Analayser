"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { NotificationItem } from "@/app/api/notifications/route";
import {
  isPushSupported,
  currentPermission,
  hasActiveSubscription,
  enablePush,
  disablePush,
} from "@/lib/pushClient";

/**
 * Bell button + dropdown panel for the TopBar. Replaces the inline
 * "X quotations need your approval" and "N folders not attached"
 * banners that used to live on /crm and /crm/company.
 *
 * Polls /api/notifications every 60s so badges stay roughly fresh
 * without hammering the DB. The dropdown closes on click-outside
 * and on Escape — mouse-leave dismiss is wrong here because the
 * panel has actionable links the user might pass over.
 */

const SEVERITY_STYLES: Record<
  NotificationItem["severity"],
  { dot: string; chip: string; title: string }
> = {
  critical: {
    dot: "bg-magic-red",
    chip: "bg-magic-red/10 text-magic-red border-magic-red/30",
    title: "text-magic-red",
  },
  warning: {
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-800 border-amber-300",
    title: "text-amber-800",
  },
  info: {
    dot: "bg-blue-500",
    chip: "bg-blue-50 text-blue-800 border-blue-300",
    title: "text-blue-800",
  },
};

export default function NotificationsBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Push state: "on" = subscribed, "off" = supported but not subscribed,
  // "denied" = browser-blocked, "unsupported"/"unconfigured" = hide.
  const [pushState, setPushState] = useState<
    "loading" | "on" | "off" | "denied" | "unsupported" | "unconfigured"
  >("loading");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!isPushSupported()) {
        if (!cancelled) setPushState("unsupported");
        return;
      }
      // Push must also be configured server-side (VAPID keys present).
      try {
        const res = await fetch("/api/push/public-key", { cache: "no-store" });
        const { key } = (await res.json()) as { key: string | null };
        if (!key) {
          if (!cancelled) setPushState("unconfigured");
          return;
        }
      } catch {
        if (!cancelled) setPushState("unconfigured");
        return;
      }
      const perm = currentPermission();
      if (perm === "denied") {
        if (!cancelled) setPushState("denied");
        return;
      }
      const active = await hasActiveSubscription();
      if (!cancelled) setPushState(active ? "on" : "off");
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  async function togglePush() {
    setPushBusy(true);
    setPushMsg(null);
    try {
      if (pushState === "on") {
        await disablePush();
        setPushState("off");
        setPushMsg("Notifications turned off on this device.");
      } else {
        await enablePush();
        setPushState("on");
        setPushMsg("Notifications enabled on this device.");
      }
    } catch (err) {
      const m = (err as Error).message;
      if (m === "blocked") {
        setPushState("denied");
        setPushMsg("Permission blocked — allow notifications in your browser settings.");
      } else if (m === "unsupported") {
        setPushState("unsupported");
      } else if (m === "unconfigured") {
        setPushState("unconfigured");
      } else {
        setPushMsg(m || "Could not change notification settings.");
      }
    } finally {
      setPushBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { items?: NotificationItem[] };
        if (!cancelled && Array.isArray(data.items)) setItems(data.items);
      } catch {
        // soft-fail — the bell goes quiet rather than throwing
      }
    }
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = items.length;
  const hasCritical = items.some((i) => i.severity === "critical");

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          count === 0
            ? "No notifications"
            : `${count} notification${count === 1 ? "" : "s"}`
        }
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-magic-border/60 bg-white/60 text-magic-ink/70 hover:bg-magic-soft hover:text-magic-ink transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {count > 0 && (
          <span
            className={`absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] rounded-full text-white text-[9px] font-bold px-1 ${
              hasCritical ? "bg-magic-red" : "bg-amber-500"
            }`}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-[22rem] max-w-[calc(100vw-1rem)] rounded-xl border border-magic-border bg-white shadow-lg py-2 z-50">
          <div className="px-3 py-1 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-magic-ink/60">
              Notifications
            </h3>
            {count > 0 && (
              <span className="text-[10px] text-magic-ink/40">
                {count} active
              </span>
            )}
          </div>
          <div className="h-px bg-magic-border/60 my-1" />
          {count === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-magic-ink/50">
              You&apos;re all caught up.
            </p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {items.map((n) => {
                const s = SEVERITY_STYLES[n.severity];
                return (
                  <li
                    key={n.id}
                    className="px-3 py-2 hover:bg-magic-soft/60 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={`mt-1.5 inline-block h-1.5 w-1.5 rounded-full shrink-0 ${s.dot}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-xs font-semibold leading-snug ${s.title}`}
                        >
                          {n.title}
                        </p>
                        {n.body && (
                          <p className="mt-0.5 text-[11px] text-magic-ink/60 leading-snug">
                            {n.body}
                          </p>
                        )}
                        {(n.action || n.secondary) && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {n.action && (
                              <Link
                                href={n.action.href}
                                onClick={() => setOpen(false)}
                                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${s.chip} hover:opacity-80 transition-opacity`}
                              >
                                {n.action.label} →
                              </Link>
                            )}
                            {n.secondary && (
                              <Link
                                href={n.secondary.href}
                                onClick={() => setOpen(false)}
                                className="inline-flex items-center rounded-md border border-magic-border bg-white px-2 py-0.5 text-[10px] font-semibold text-magic-ink/70 hover:bg-magic-soft transition-colors"
                              >
                                {n.secondary.label}
                              </Link>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {pushState !== "loading" &&
            pushState !== "unsupported" &&
            pushState !== "unconfigured" && (
              <div className="mt-1 border-t border-magic-border/60 px-3 pt-2">
                {pushState === "denied" ? (
                  <p className="text-[11px] text-magic-ink/50">
                    Notifications are blocked in your browser. Enable them in
                    the site settings to get alerts on this device.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => void togglePush()}
                    disabled={pushBusy}
                    className="inline-flex items-center gap-1.5 rounded-md border border-magic-border bg-white px-2.5 py-1 text-[11px] font-semibold text-magic-ink/80 hover:bg-magic-soft disabled:opacity-50 transition-colors"
                  >
                    {pushState === "on"
                      ? "Disable device notifications"
                      : "Enable notifications on this device"}
                  </button>
                )}
                {pushMsg && (
                  <p className="mt-1 text-[11px] text-magic-ink/50">{pushMsg}</p>
                )}
              </div>
            )}
        </div>
      )}
    </div>
  );
}
