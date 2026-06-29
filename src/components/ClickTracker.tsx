"use client";

import { useEffect } from "react";

/**
 * Records every click and ships it to /api/syslog, where it's stored for one
 * week (Admin → Syslog shows the feed). Clicks are buffered and flushed in
 * small batches — every 4s, once 10 pile up, or when the tab is hidden/closed —
 * so a busy session is a handful of beacons, not one request per click.
 *
 * Mounted app-wide in the root layout. It's best-effort: if the user isn't
 * signed in (e.g. the login page) the beacon just 401s and is ignored.
 */

const CLICKABLE = new Set([
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "summary",
  "label",
  "option",
]);

export default function ClickTracker() {
  useEffect(() => {
    let buffer: Array<{ path: string; label: string; tag: string; t: string }> = [];
    let timer: number | null = null;

    function describe(start: EventTarget | null): { label: string; tag: string } {
      let node = start instanceof HTMLElement ? start : null;
      // Climb to the nearest meaningful interactive ancestor.
      for (let i = 0; node && i < 4; i++) {
        const tag = node.tagName.toLowerCase();
        if (CLICKABLE.has(tag) || node.getAttribute("role") === "button") break;
        node = node.parentElement;
      }
      const el = node ?? (start instanceof HTMLElement ? start : null);
      if (!el) return { label: "", tag: "" };
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      const label =
        el.getAttribute("aria-label") ||
        text ||
        el.getAttribute("title") ||
        el.getAttribute("name") ||
        el.getAttribute("placeholder") ||
        "";
      return { label: label.slice(0, 120), tag: el.tagName.toLowerCase() };
    }

    function flush() {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (buffer.length === 0) return;
      const events = buffer;
      buffer = [];
      try {
        const body = JSON.stringify({ events });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(
            "/api/syslog",
            new Blob([body], { type: "application/json" }),
          );
        } else {
          void fetch("/api/syslog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        /* best-effort */
      }
    }

    function onClick(e: MouseEvent) {
      const { label, tag } = describe(e.target);
      buffer.push({
        path: window.location.pathname,
        label,
        tag,
        t: new Date().toISOString(),
      });
      if (buffer.length >= 10) flush();
      else if (timer === null) timer = window.setTimeout(flush, 4000);
    }

    function onHide() {
      if (document.visibilityState === "hidden") flush();
    }

    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  return null;
}
