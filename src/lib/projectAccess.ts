import { sql } from "./db";
import type { SessionUser } from "./auth";
import { canReadAll } from "./auth";

/**
 * Shared "can this user see this project?" check used by every route
 * under the CRM project drill-down. Returns the resolved project
 * record (with the owning folder + folder kind), or `null` when the
 * caller cannot see it. Callers branch on the value rather than
 * throwing — the drill-down layouts render a friendly "no access"
 * page instead of a 403 so the user can still navigate elsewhere.
 *
 * Access rules:
 *   - admin                     → always
 *   - project owner             → always
 *   - folder owner              → always
 *   - any projects-module role  → always
 *   - active assignment on this project → always
 */
export interface ProjectAccessResult {
  id: number;
  folder_id: number;
  folder_name: string;
  folder_kind: "company" | "individual" | null;
  folder_owner_id: number | null;
  folder_company_id: number | null;
  owner_id: number | null;
  name: string;
  description: string | null;
  status: string;
}

export async function loadAccessibleProject(
  user: SessionUser,
  projectId: number,
  folderId: number,
): Promise<ProjectAccessResult | null> {
  if (!Number.isFinite(projectId) || projectId <= 0) return null;
  if (!Number.isFinite(folderId) || folderId <= 0) return null;
  const q = sql();
  const rows = (await q`
    select p.id, p.folder_id, p.owner_id, p.name, p.description, p.status,
           cf.name as folder_name, cf.kind as folder_kind,
           cf.owner_id as folder_owner_id, cf.company_id as folder_company_id
    from projects p
    join client_folders cf on cf.id = p.folder_id
    where p.id = ${projectId} and cf.id = ${folderId}
      and p.deleted_at is null and cf.deleted_at is null
    limit 1
  `) as ProjectAccessResult[];
  if (rows.length === 0) return null;
  const project = rows[0];

  const isAdmin = canReadAll(user);
  if (isAdmin) return project;
  if (project.owner_id === user.id) return project;
  if (project.folder_owner_id === user.id) return project;

  const hasProjects = (await q`
    select 1 from user_module_roles
    where user_id = ${user.id} and module = 'projects' and revoked_at is null
    limit 1
  `) as Array<{ "?column?": number }>;
  if (hasProjects.length > 0) return project;

  const assigned = (await q`
    select 1 from project_assignments
    where project_id = ${projectId} and user_id = ${user.id} and deleted_at is null
    limit 1
  `) as Array<{ "?column?": number }>;
  if (assigned.length > 0) return project;

  return null;
}

/**
 * "Assigned work" scoping for the CRM client drill-down.
 *
 * A projects-module user (technician / engineer) who owns no CRM records
 * still needs to reach the company → client → project tree for the
 * projects assigned to them — and ONLY those. These helpers return the
 * ids of the rows that contain a live project the user is assigned to, so
 * the listing queries can show "owned OR assigned" and nothing else. A
 * user with no assignments gets empty arrays, which scope every list down
 * to just the rows they own (the pre-existing behaviour for sales /
 * presales, unchanged).
 */

/** Company ids that own a folder holding a project the user is assigned to. */
export async function assignedCompanyIds(userId: number): Promise<number[]> {
  const q = sql();
  const rows = (await q`
    select distinct cf.company_id
    from project_assignments pa
    join projects p on p.id = pa.project_id and p.deleted_at is null
    join client_folders cf on cf.id = p.folder_id and cf.deleted_at is null
    where pa.user_id = ${userId} and pa.deleted_at is null
      and cf.company_id is not null
  `) as Array<{ company_id: number }>;
  return rows.map((r) => r.company_id);
}

/** Folder (client) ids holding a project the user is assigned to. */
export async function assignedFolderIds(userId: number): Promise<number[]> {
  const q = sql();
  const rows = (await q`
    select distinct p.folder_id
    from project_assignments pa
    join projects p on p.id = pa.project_id and p.deleted_at is null
    where pa.user_id = ${userId} and pa.deleted_at is null
  `) as Array<{ folder_id: number }>;
  return rows.map((r) => r.folder_id);
}

/** Project ids the user is assigned to (live projects). */
export async function assignedProjectIds(userId: number): Promise<number[]> {
  const q = sql();
  const rows = (await q`
    select distinct pa.project_id
    from project_assignments pa
    join projects p on p.id = pa.project_id and p.deleted_at is null
    where pa.user_id = ${userId} and pa.deleted_at is null
  `) as Array<{ project_id: number }>;
  return rows.map((r) => r.project_id);
}

/**
 * The set of project ids that share a file workspace because they are the
 * two sides of the SAME lead.
 *
 * A salesperson raises an RFQ on their own project X (`leads.sales_project_id`);
 * presales claims it and re-files it under their own project Y
 * (`leads.project_id`). The DWGs, BOQ and other attachments belong to the one
 * deal, so they should be visible from BOTH routes — Mosa's sales project and
 * Raghad's presales project — without ever duplicating a row. This returns the
 * id you passed plus every linked counterpart (deduped).
 *
 * A project never touched by a lead just returns `[projectId]`, i.e. it shares
 * with nobody (existing single-project behaviour, unchanged).
 */
export async function getLinkedProjectIds(
  projectId: number,
): Promise<number[]> {
  if (!Number.isFinite(projectId) || projectId <= 0) return [];
  const q = sql();
  const rows = (await q`
    select project_id, sales_project_id
    from leads
    where deleted_at is null
      and (project_id = ${projectId} or sales_project_id = ${projectId})
  `) as Array<{ project_id: number | null; sales_project_id: number | null }>;
  const ids = new Set<number>([projectId]);
  for (const r of rows) {
    if (r.project_id) ids.add(r.project_id);
    if (r.sales_project_id) ids.add(r.sales_project_id);
  }
  return [...ids];
}

/**
 * Owner-level write reach to a project's shared file workspace: the project
 * owner, the owning client-folder owner, OR the owner (or folder owner) of a
 * lead-linked counterpart project — the sales ↔ presales other side of the
 * same deal. This is what lets a salesperson drop the client's signed PO (or
 * a DWG) onto a deal whose quotation physically lives under the presales
 * project, and have it land in the one shared workspace. Admins are handled
 * by the caller.
 */
export async function userOwnsProjectOrLinked(
  projectId: number,
  userId: number,
): Promise<boolean> {
  const ids = await getLinkedProjectIds(projectId);
  if (ids.length === 0) return false;
  const q = sql();
  const rows = (await q`
    select 1 from projects p
    join client_folders cf on cf.id = p.folder_id
    where p.id = any(${ids}::int[]) and p.deleted_at is null
      and (p.owner_id = ${userId} or cf.owner_id = ${userId})
    limit 1
  `) as Array<{ "?column?": number }>;
  return rows.length > 0;
}

/** True when the user has an active assignment on this exact project. */
export async function userIsAssignedToProject(
  projectId: number,
  userId: number,
): Promise<boolean> {
  const q = sql();
  const rows = (await q`
    select 1 from project_assignments
    where project_id = ${projectId} and user_id = ${userId}
      and deleted_at is null
    limit 1
  `) as Array<{ "?column?": number }>;
  return rows.length > 0;
}

/** True when the user is assigned to any live project inside the folder. */
export async function userHasAssignedProjectInFolder(
  userId: number,
  folderId: number,
): Promise<boolean> {
  const q = sql();
  const rows = (await q`
    select 1 from project_assignments pa
    join projects p on p.id = pa.project_id and p.deleted_at is null
    where pa.user_id = ${userId} and pa.deleted_at is null
      and p.folder_id = ${folderId}
    limit 1
  `) as Array<{ "?column?": number }>;
  return rows.length > 0;
}
