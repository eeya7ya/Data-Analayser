/**
 * Auth helpers that are safe to import from client components.
 *
 * `src/lib/auth.ts` pulls in `next/headers` (for the cookie jar) and
 * `./db` (for the user lookup), neither of which webpack will bundle
 * into a "use client" component. The pure role-shape helpers below
 * have no such deps, so client code imports them from here.
 */

export type SessionRole = "admin" | "viewer" | "user";

/** True for admin OR viewer — anyone allowed to see cross-user data. */
export function canReadAll(user: { role: string }): boolean {
  return user.role === "admin" || user.role === "viewer";
}

/** False for viewer; admins and regular users can mutate their scope. */
export function canWrite(user: { role: string }): boolean {
  return user.role !== "viewer";
}
