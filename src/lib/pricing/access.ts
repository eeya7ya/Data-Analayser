import { sql } from "@/lib/db";
import { canReadAll, type SessionUser } from "@/lib/auth";

/**
 * Pricing-module access helpers.
 *
 * The pricing sheet workspace mirrors the host's "admin sees all,
 * everyone else sees their own" model — but the source rows live in
 * `pricing_*` tables that have their own ownership columns. These
 * helpers centralise the "can this user touch this row?" checks so
 * routes stay terse.
 *
 * Role mapping into the host's SessionUser:
 *   • role === "admin" OR "viewer" (canReadAll) → pricing admin scope
 *     (see every user's manufacturers and projects)
 *   • everything else → pricing user scope (own user_manufacturers,
 *     own projects)
 *
 * Mutations also respect the host's writer gate — viewers see
 * everything but can never POST/PUT/DELETE.
 */

/** Default colour assigned to a user's first manufacturer pin. */
export const DEFAULT_USER_COLOR = "cyan";

/** Returns true when the user can see every pricing row in the system. */
export function isPricingAdmin(user: SessionUser): boolean {
  return canReadAll(user);
}

/**
 * Check whether `user` may read manufacturer `mfgId`. Admins always pass.
 * Regular users need an active row in pricing_user_manufacturers.
 *
 * Returns null when allowed, or the JSON error body + status to return.
 */
export async function assertManufacturerVisible(
  user: SessionUser,
  mfgId: number,
): Promise<null | { error: string; status: number }> {
  if (isPricingAdmin(user)) return null;
  const q = sql();
  const rows = (await q`
    select 1 as ok from pricing_user_manufacturers
    where user_id = ${user.id}
      and manufacturer_id = ${mfgId}
      and deleted_at is null
    limit 1
  `) as Array<{ ok: number }>;
  if (rows.length === 0) return { error: "Forbidden", status: 403 };
  return null;
}

/**
 * Check whether `user` may read project `projectId`. Admins always pass.
 * Regular users may read their own projects only.
 */
export async function assertProjectVisible(
  user: SessionUser,
  projectId: number,
): Promise<null | { error: string; status: number }> {
  const q = sql();
  if (isPricingAdmin(user)) {
    const rows = (await q`
      select 1 as ok from pricing_projects
      where id = ${projectId} and deleted_at is null
      limit 1
    `) as Array<{ ok: number }>;
    if (rows.length === 0) return { error: "Not found", status: 404 };
    return null;
  }
  const rows = (await q`
    select 1 as ok from pricing_projects
    where id = ${projectId}
      and deleted_at is null
      and user_id = ${user.id}
    limit 1
  `) as Array<{ ok: number }>;
  if (rows.length === 0) return { error: "Not found", status: 404 };
  return null;
}
