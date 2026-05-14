import { sql } from "./db";
import type { SessionUser } from "./auth";

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

  const isAdmin = user.role === "admin";
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
