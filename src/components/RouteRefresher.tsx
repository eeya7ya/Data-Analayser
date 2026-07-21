"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a server-rendered page's data fresh without a manual reload.
 *
 * The dashboard is a `force-dynamic` server component, but Next's client-side
 * Router Cache can still hand back a previously-rendered RSC payload when the
 * user navigates back to it, so freshly-changed database numbers appeared to
 * "lag". This calls `router.refresh()` — which re-runs the server component and
 * reconciles in place, no full page reload — whenever the tab regains
 * focus/visibility and on a light interval while the page is visible, so the
 * numbers track the database closely.
 *
 * The mount-time reconcile is *conditional* on `renderedAt` (a server
 * timestamp stamped into the payload). A forward navigation just rendered the
 * page on the server milliseconds ago — refreshing again on mount doubled
 * every dashboard load (2× the queries, 2× the wait, competing with the
 * TopBar/notifications fetches during first paint). Now the mount refresh only
 * fires when the payload is actually old (a back/forward restore from the
 * Router Cache), which is the one case it was added for.
 */
export default function RouteRefresher({
  intervalMs = 30000,
  renderedAt,
}: {
  intervalMs?: number;
  /** Server-side Date.now() of the render this payload came from. */
  renderedAt?: number;
}) {
  const router = useRouter();
  // The payload's age matters only at mount; keep the first value so the
  // effect doesn't re-run when the server re-renders with a new timestamp.
  const renderedAtRef = useRef(renderedAt);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    // Reconcile on mount ONLY for stale payloads (client-side back/forward
    // navigation restoring a cached RSC render). Fresh forward navigations
    // skip this — the data is seconds old at most, and refreshing again
    // doubled the server work of every navigation.
    const at = renderedAtRef.current;
    const isStalePayload = typeof at === "number" && Date.now() - at > 10_000;
    if (isStalePayload || at === undefined) refresh();
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
