/**
 * News/announcement audience helpers — backend-agnostic and dependency-free, so
 * both the API routes and client components can import them.
 *
 * `news_posts.audience_modules` / `audience_roles` are Postgres `text[]`
 * columns, but on Cloudflare D1 (SQLite) they're stored as JSON text (e.g.
 * `'["all"]'`). Reading them therefore yields an array on Postgres and a string
 * on D1 — calling `.join()` / `.map()` on the string is what white-screened the
 * admin page (`audience_modules.join is not a function`). And D1 has no `&&`
 * array-overlap operator, so the SQL audience filter 500'd there. These helpers
 * normalise the value to a real array and do the overlap check in JS, which
 * behaves identically on both backends.
 */

/** Normalise a stored audience value to a string[] regardless of backend. */
export function toAudienceArray(value: unknown): string[] {
  // Postgres text[] — already an array.
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return [];
    // D1 stores JSON text: '["all","sales"]'.
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s);
        return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [s];
      } catch {
        return [s];
      }
    }
    // A Postgres array literal that slipped through as text: '{all,sales}'.
    if (s.startsWith("{") && s.endsWith("}")) {
      return s
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
    }
    // A bare single value: 'all'.
    return [s];
  }
  return [];
}

/**
 * True when a post's audience overlaps the viewer's tags. Mirrors Postgres'
 * `post.audience && userTags` overlap: callers include the `'all'` wildcard in
 * `userTags`, and a post tagged `'all'` matches everyone, so a plain
 * set-intersection is exactly the right semantics.
 */
export function audienceOverlaps(
  postTags: string[],
  userTags: string[],
): boolean {
  return postTags.some((t) => userTags.includes(t));
}
