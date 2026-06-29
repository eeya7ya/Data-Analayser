import { sql } from "./db";
import { canReadAll, type SessionUser } from "./auth";

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

export const MODULES = ["crm", "projects", "storage", "admin", "pricing"] as const;
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
  pricing: ["sales", "presales", "manager"],
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
  if (canReadAll(user)) return;
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
  if (canReadAll(user)) return;
  if (await hasModule(user.id, module)) return;

  // Presales prepare manufacturer pricing as part of their lifecycle
  // (pricing sheet → quotation), so a crm presales / presales_manager
  // role grants access to the pricing module too.
  if (
    module === "pricing" &&
    ((await hasModuleRole(user.id, "crm", "presales")) ||
      (await hasModuleRole(user.id, "crm", "presales_manager")))
  ) {
    return;
  }

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
        insert into syslog (actor_id, entity_type, entity_id, verb, meta_json)
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

/**
 * Read gate for the CRM client drill-down (companies / folders / projects
 * list endpoints). Sales & presales reach it through the `crm` module;
 * projects-module users (technicians / engineers / managers) reach the same
 * client → project tree to find the projects assigned to them. So either
 * module — or the legacy no-grants bypass — passes. The listing queries
 * still scope rows to "owned OR assigned", so this only governs whether the
 * endpoint can be hit, not what data comes back.
 */
export async function requireCrmOrProjectsRead(user: SessionUser): Promise<void> {
  if (canReadAll(user)) return;
  if (await hasModule(user.id, "crm")) return;
  if (await hasModule(user.id, "projects")) return;

  // Legacy bypass — mirror requireModuleAllowLegacy: a user with NO module
  // grants at all is allowed (and audited) during the V2 transition.
  const q = sql();
  const anyRoles = (await q`
    select 1 as ok from user_module_roles
    where user_id = ${user.id} and revoked_at is null
    limit 1
  `) as Array<{ ok: number }>;
  if (anyRoles.length === 0) {
    try {
      await q`
        insert into syslog (actor_id, entity_type, entity_id, verb, meta_json)
        values (${user.id}, 'module_access', 0, 'legacy_bypass',
                ${JSON.stringify({ module: "crm_or_projects" })}::jsonb)
      `;
    } catch {
      // never block a request because audit logging failed
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
  if (canReadAll(user)) return;
  if (await hasModuleRole(user.id, module, role)) return;
  throw new Error("FORBIDDEN");
}

/**
 * V1.3b — true when the user is a "plain salesperson": they hold the
 * `crm:sales` grant but NONE of the roles that are allowed to author /
 * edit a quotation in the Designer (admin, presales, presales_manager,
 * sales_manager). These users receive quotations from presales and may
 * only view / print / convert / request changes — never open the
 * Designer in edit mode. Used by /api/quotations PATCH and the Designer
 * page to enforce the lock server-side; the client mirrors the same rule
 * for button visibility via /api/auth/me.
 */
export async function isSalesEditLocked(user: SessionUser): Promise<boolean> {
  if (canReadAll(user)) return false; // admin / viewer are never sales-locked
  const grants = await getUserModuleRoles(user.id);
  const crm = grants.filter((g) => g.module === "crm").map((g) => g.role);
  const hasSales = crm.includes("sales");
  const hasElevated =
    crm.includes("presales") ||
    crm.includes("presales_manager") ||
    crm.includes("sales_manager");
  return hasSales && !hasElevated;
}

/**
 * V2.x — authoritative "may author a priced quotation" gate.
 *
 * Authoring (creating/pricing a quotation in the Designer, AI Designer or
 * Catalogue) is restricted to presales, presales managers, and admins.
 * Everyone else in CRM — plain sales, sales managers, and legacy users
 * with no module grants — may only file a Request for Quotation
 * (mode=review) for presales to pick up. This is a positive allow-list
 * (not the inverse of the sales lock) so it deliberately excludes
 * sales_manager and the legacy no-grants bypass that `isSalesEditLocked`
 * lets through.
 *
 * Note: `viewer` is intentionally excluded even though `canReadAll`
 * covers it — viewers are read-only and must never mutate.
 */
export async function canAuthorQuotation(user: SessionUser): Promise<boolean> {
  if (user.role === "admin") return true;
  const grants = await getUserModuleRoles(user.id);
  return grants.some(
    (g) =>
      g.module === "crm" &&
      (g.role === "presales" || g.role === "presales_manager"),
  );
}

/**
 * CRM project-view capabilities, resolved in a single pass so server pages
 * can hand them straight to the project drill-down. The client used to
 * derive these from a `/api/auth/me` round-trip on mount (the `useCrmCaps`
 * hook), which on a cold pooler left every sales / presales action button
 * blank for a few seconds — the "new buttons render delayed" complaint.
 * Computing them on the server and seeding the client lets the buttons
 * paint on first render.
 *
 * This is a faithful mirror of the previous client logic — same allow-lists,
 * no behaviour change — just moved earlier in the request.
 */
export interface CrmCaps {
  /** Presales / admin: design + upload + send quotations in-app. */
  canAuthorQuotation: boolean;
  /** Sales / sales_manager: raise a Request for Quotation. */
  canRequestQuotation: boolean;
  /** Sales + presales + admin: the shared deal-economics view. */
  canSeeFinancialOffer: boolean;
  /** Presales / admin only: the engineering deliverable view. */
  canSeeTechnicalProposal: boolean;
}

export async function getCrmCaps(user: SessionUser): Promise<CrmCaps> {
  const isAdmin = user.role === "admin";
  const grants = isAdmin ? [] : await getUserModuleRoles(user.id);
  const crm = grants
    .filter((g) => g.module === "crm")
    .map((g) => g.role);
  const hasPresales =
    crm.includes("presales") || crm.includes("presales_manager");
  const hasSales = crm.includes("sales") || crm.includes("sales_manager");
  return {
    canAuthorQuotation: isAdmin || hasPresales,
    canRequestQuotation: hasSales,
    canSeeFinancialOffer: isAdmin || hasPresales || hasSales,
    canSeeTechnicalProposal: isAdmin || hasPresales,
  };
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
