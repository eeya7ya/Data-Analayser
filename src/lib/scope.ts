import { sql } from "./db";
import { canReadAll, type SessionUser } from "./auth";
import { isModuleManager } from "./modules";
import type { Module } from "./modules";

/**
 * Visibility scoping helpers.
 *
 * The rule, by module:
 *   - admin               → sees everything (no scope predicate).
 *   - non-manager user    → sees rows they own (owner_id = self) plus
 *                           rows assigned to them via project_assignments.
 *   - module manager      → sees rows owned by anyone in any team
 *                           (`teams.module = $module`) where the user is
 *                           the team's `manager_user_id`.
 *
 * Every helper returns a deduplicated, ascending list of integer IDs so
 * callers can drop it straight into `where x.id = any($1)` without
 * additional joins. When the result is empty AND the user is NOT admin,
 * callers should treat that as "no rows visible" — never as "no scope,
 * show everything". The convenience `Scope` type makes that explicit.
 */

export interface Scope {
  /** True when the caller should bypass all visibility filters. */
  allAccess: boolean;
  /** user_id values the caller is allowed to see rows for. Ignored when allAccess=true. */
  userIds: number[];
  /** Specific project_ids the caller is assigned to (additive to userIds). */
  projectIds: number[];
}

/**
 * All user IDs in the same tenant as `userId` (multi-tenancy ceiling).
 *
 * This is the hard limit for any cross-user visibility: an admin/viewer/manager
 * may only ever see rows owned by users in their OWN tenant. The list always
 * contains at least the requester, so filtering `owner_id = any(result)` fails
 * closed (returns nothing) rather than leaking across tenants.
 *
 * `is not distinct from` treats a legacy NULL tenant as equal to NULL, so a
 * not-yet-backfilled deployment behaves exactly as before (one tenant = all
 * users). In the current single-tenant DB this returns every user, which makes
 * the tenant-scoping behaviour-preserving in production.
 */
export async function getTenantUserIds(userId: number): Promise<number[]> {
  const q = sql();
  const rows = (await q`
    select u2.id from users u2
    where u2.tenant_id is not distinct from
          (select tenant_id from users where id = ${userId})
  `) as Array<{ id: number }>;
  const ids = rows.map((r) => r.id);
  // Defensive: never return empty (would be ambiguous at call sites).
  return ids.length > 0 ? ids : [userId];
}

/** Team IDs where this user is the configured manager, scoped to one module. */
export async function getManagedTeamIds(
  userId: number,
  module: Module,
): Promise<number[]> {
  const q = sql();
  const rows = (await q`
    select id from teams
    where manager_user_id = ${userId}
      and module = ${module}
      and deleted_at is null
  `) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

/** All user IDs that belong to any of the given teams. */
export async function getTeamMemberIds(teamIds: number[]): Promise<number[]> {
  if (teamIds.length === 0) return [];
  const q = sql();
  const rows = (await q`
    select distinct user_id
    from team_members
    where team_id = any(${teamIds})
  `) as Array<{ user_id: number }>;
  return rows.map((r) => r.user_id);
}

/** Projects the user has an active assignment on (Projects-module only). */
export async function getAssignedProjectIds(userId: number): Promise<number[]> {
  const q = sql();
  const rows = (await q`
    select distinct project_id
    from project_assignments
    where user_id = ${userId}
      and deleted_at is null
  `) as Array<{ project_id: number }>;
  return rows.map((r) => r.project_id);
}

/**
 * Compute the full visibility scope for a user within a module.
 *
 *   - Admin → allAccess.
 *   - Module manager → self + every member of every team they manage in
 *     that module.
 *   - Plain user → self only. Project-module users additionally see
 *     projects they're assigned to via project_assignments.
 */
export async function getScope(
  user: SessionUser,
  module: Module,
): Promise<Scope> {
  if (canReadAll(user)) {
    return { allAccess: true, userIds: [], projectIds: [] };
  }

  const userIds = new Set<number>([user.id]);

  if (await isModuleManager(user.id, module)) {
    const teamIds = await getManagedTeamIds(user.id, module);
    const memberIds = await getTeamMemberIds(teamIds);
    for (const id of memberIds) userIds.add(id);
  }

  const projectIds =
    module === "projects" ? await getAssignedProjectIds(user.id) : [];

  return {
    allAccess: false,
    userIds: [...userIds].sort((a, b) => a - b),
    projectIds: [...projectIds].sort((a, b) => a - b),
  };
}

/**
 * Folder IDs visible to the user under `module`. Built on top of
 * getScope: returns folders owned by any in-scope user. Project-module
 * callers additionally pick up folders that own a project the user is
 * directly assigned to.
 */
export async function getVisibleFolderIds(
  user: SessionUser,
  module: Module,
): Promise<{ allAccess: boolean; ids: number[] }> {
  const scope = await getScope(user, module);
  if (scope.allAccess) return { allAccess: true, ids: [] };

  const q = sql();
  const direct = (await q`
    select id from client_folders
    where deleted_at is null
      and owner_id = any(${scope.userIds})
  `) as Array<{ id: number }>;

  const viaAssignments =
    scope.projectIds.length > 0
      ? ((await q`
          select distinct folder_id as id
          from projects
          where id = any(${scope.projectIds})
            and folder_id is not null
            and deleted_at is null
        `) as Array<{ id: number }>)
      : [];

  const merged = new Set<number>();
  for (const r of direct) merged.add(r.id);
  for (const r of viaAssignments) merged.add(r.id);

  return { allAccess: false, ids: [...merged].sort((a, b) => a - b) };
}

/**
 * Project IDs visible to the user. Owned + team-member-owned (when
 * manager) + explicit project_assignments.
 */
export async function getVisibleProjectIds(
  user: SessionUser,
  module: Module,
): Promise<{ allAccess: boolean; ids: number[] }> {
  const scope = await getScope(user, module);
  if (scope.allAccess) return { allAccess: true, ids: [] };

  const q = sql();
  const direct = (await q`
    select id from projects
    where deleted_at is null
      and owner_id = any(${scope.userIds})
  `) as Array<{ id: number }>;

  const merged = new Set<number>(scope.projectIds);
  for (const r of direct) merged.add(r.id);

  return { allAccess: false, ids: [...merged].sort((a, b) => a - b) };
}
