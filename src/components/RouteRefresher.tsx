"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a server-rendered page's data fresh without a manual reload.
 *
 * The dashboard is a `force-dynamic` server component, but Next's client-side
 * Router Cache can still hand back a previously-rendered RSC payload when the
 * user navigates back to it, so freshly-changed database numbers appeared to
 * "lag". This calls `router.refresh()` — which re-runs the server component and
 * reconciles in place, no full page reload — whenever the tab regains
 * focus/visibility, plus on a light interval while the page is visible, so the
 * numbers track the database closely.
 */
export default function RouteRefresher({
  intervalMs = 30000,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const id =
      intervalMs > 0 ? window.setInterval(refresh, intervalMs) : null;
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      if (id) window.clearInterval(id);
    };
  }, [router, intervalMs]);

  return null;
}
