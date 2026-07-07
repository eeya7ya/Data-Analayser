/**
 * Client-side session-expiry guard.
 *
 * Admin APIs (users, syslog, …) reject requests with HTTP 401 "UNAUTHENTICATED"
 * when the `mt_session` cookie is missing/expired/invalid — e.g. a tab left open
 * past the 7-day JWT expiry, or a redeploy that rotated AUTH_SECRET. Without
 * handling, the page just surfaces raw "UNAUTHENTICATED" errors and a console
 * full of failed requests (the "what is this issue" symptom).
 *
 * Call this on any fetch Response from an authenticated endpoint: when the
 * session is gone it bounces the user to the login page (preserving where they
 * were, so they land back here after signing in) and returns true so the caller
 * can stop processing. Returns false for every other status.
 */
export function redirectIfSessionExpired(res: Response): boolean {
  if (res.status === 401 && typeof window !== "undefined") {
    const here = window.location.pathname + window.location.search;
    window.location.href = `/login?next=${encodeURIComponent(here)}`;
    return true;
  }
  return false;
}
