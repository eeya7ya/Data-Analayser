import { sql } from "./db";
import type { SessionUser } from "./auth";

/**
 * V2.0 module RBAC.
 *
 * The app is split into four top-level modules. A user can hold any
 * combination of (module, role) grants stored in `user_module_roles`.
 * Legacy `users.role = 'admin'` still confers full admin access —
 * Phase 1 seeded those users into `user_module_roles` with
 * ('admin', 'admin'), but we also honour the legacy column directly
 * here so a fresh admin row works even before re-seeding.
 *
 * Grants are NEVER hard-deleted. Revocation flips `revoked_at`; active
 * grants are filtered with `revoked_at is null`. Re-granting a
 * previously revoked role is an UPSERT that clears the revoke columns
 * (the composite PK enforces uniqueness across (user_id, module, role)).
 */

export const MODULES = ["crm", "projects", "storage", "admin"] as const;
export type Module = (typeof MODULES)[number];

/**
 * Canonical role names per module. Adding a new role: append it to the
 * matching array and the CHECK constraint in user_module_roles —
 * existing data is unaffected because the column is plain text.
 */
export const ROLES_PER_MODULE = {
  crm: ["sales", "sales_manager", "presales", "presales_manager"],
  projects: ["technical", "engineer", "manager"],
  storage: ["worker", "manager"],
  admin: ["admin"],
} as const satisfies Record<Module, readonly string[]>;

export type ModuleRole<M extends Module = Module> =
  (typeof ROLES_PER_MODULE)[M][number];

export interface ModuleGrant {
  user_id: number;
  module: Module;
  role: string;
  granted_by: number | null;
  created_at: string;
}

/** Active (non-revoked) grants for one user. Cached per request via React cache where called. */
export async function getUserModuleRoles(userId: number): Promise<ModuleGrant[]> {
  const q = sql();
  const rows = (await q`
    select user_id, module, role, granted_by, created_at
    from user_module_roles
    where user_id = ${userId}
      and revoked_at is null
    order by module, role
  `) as ModuleGrant[];
  return rows;
}

/** True when the user has ANY active role within `module`. */
export async function hasModule(userId: number, module: Module): Promise<boolean> {
  const q = sql();
  const rows = (await q`
    select 1 as ok
    from user_module_roles
    where user_id = ${userId}
      and module = ${module}
      and revoked_at is null
    limit 1
  `) as Array<{ ok: number }>;
  return rows.length > 0;
}

/** True when the user holds the exact (module, role) grant. */
export async function hasModuleRole(
  userId: number,
  module: Module,
  role: string,
): Promise<boolean> {
  const q = sql();
  const rows = (await q`
    select 1 as ok
    from user_module_roles
    where user_id = ${userId}
      and module = ${module}
      and role = ${role}
      and revoked_at is null
    limit 1
  `) as Array<{ ok: number }>;
  return rows.length > 0;
}

/**
 * Throw FORBIDDEN unless the user can access `module`. Legacy
 * `users.role = 'admin'` always passes — those users were seeded into
 * user_module_roles in Phase 1 but we don't want a fresh admin row
 * (created post-Phase-1) locked out before an admin grants them
 * modules explicitly.
 */
export async function requireModule(
  user: SessionUser,
  module: Module,
): Promise<void> {
  if (user.role === "admin") return;
  if (await hasModule(user.id, module)) return;
  throw new Error("FORBIDDEN");
}

/**
 * Legacy-aware module gate used by routes that existed before V2.0.
 *
 * Resolution order:
 *   1. Admin (users.role = 'admin') → always allowed.
 *   2. User holds any active role in `module` → allowed.
 *   3. User holds NO active module roles at all → allowed AND a
 *      "legacy_bypass" audit entry is written so admins see who would
 *      have been blocked. This is the transitional safety valve for
 *      the 3 existing users who don't have module grants yet — the
 *      moment an admin grants them ANY role (anywhere), this branch
 *      stops firing and strict enforcement kicks in for them.
 *   4. User holds module roles but none in `module` → FORBIDDEN.
 *
 * The audit log lets admins triage who to grant explicitly without
 * breaking anyone's workflow during the transition.
 */
export async function requireModuleAllowLegacy(
  user: SessionUser,
  module: Module,
): Promise<void> {
  if (user.role === "admin") return;
  if (await hasModule(user.id, module)) return;

  const q = sql();
  const anyRoles = (await q`
    select 1 as ok from user_module_roles
    where user_id = ${user.id} and revoked_at is null
    limit 1
  `) as Array<{ ok: number }>;

  if (anyRoles.length === 0) {
    // Legacy bypass. Log it so the admin can see who needs explicit grants.
    // The activity_log INSERT is fire-and-forget for latency — we don't
    // want a slow log write to block the request, but we do want every
    // bypass recorded. Errors are swallowed because logging failure
    // shouldn't deny the actual request.
    try {
      await q`
        insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
        values (${user.id}, 'module_access', 0, 'legacy_bypass',
                ${JSON.stringify({ module })}::jsonb)
      `;
    } catch {
      // ignore — never block a request because audit logging failed
    }
    return;
  }

  throw new Error("FORBIDDEN");
}

/** Throw FORBIDDEN unless the user holds (module, role). Admin override applies. */
export async function requireModuleRole(
  user: SessionUser,
  module: Module,
  role: string,
): Promise<void> {
  if (user.role === "admin") return;
  if (await hasModuleRole(user.id, module, role)) return;
  throw new Error("FORBIDDEN");
}

/**
 * True when the user holds any role in `module` whose name ends in
 * `_manager` (e.g. sales_manager, presales_manager, manager). Phase 3
 * uses this to widen visibility scope to team-member rows.
 */
export async function isModuleManager(
  userId: number,
  module: Module,
): Promise<boolean> {
  const q = sql();
  const rows = (await q`
    select 1 as ok
    from user_module_roles
    where user_id = ${userId}
      and module = ${module}
      and role like '%manager%'
      and revoked_at is null
    limit 1
  `) as Array<{ ok: number }>;
  return rows.length > 0;
}
