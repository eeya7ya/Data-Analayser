import { sql } from "@/lib/db";

/**
 * Every client folder should have at least one project so quotations
 * never end up "Unfiled" in the project view. The original migration
 * back-filled a "Default Project" for every folder that existed at the
 * time and assigned every orphan quotation to it, but folders and
 * quotations created after the migration ran were skipping that logic
 * entirely. These helpers re-apply the same idea on demand so the
 * folder page, the quotation creator, and the company sync all leave
 * the data in the expected shape.
 */

/**
 * Return the project id every loose quotation in this folder should
 * attach to. Reuses any existing live project on the folder; only
 * creates a fresh "Default Project" when the folder has nothing at
 * all, so we don't keep minting defaults next to a user-renamed one.
 */
export async function ensureDefaultProject(args: {
  folderId: number;
  ownerId: number | null;
}): Promise<number | null> {
  const { folderId, ownerId } = args;
  const q = sql();

  const existing = (await q`
    select id from projects
    where folder_id = ${folderId} and deleted_at is null
    order by id asc
    limit 1
  `) as Array<{ id: number }>;
  if (existing.length > 0) return existing[0].id;

  const inserted = (await q`
    insert into projects (folder_id, owner_id, name, description, status)
    values (
      ${folderId}, ${ownerId}, 'Default Project',
      'Auto-created so quotations filed under this client land somewhere by default. Rename or split into focused projects any time.',
      'open'
    )
    returning id
  `) as Array<{ id: number }>;
  return inserted[0]?.id ?? null;
}

/**
 * Reassign every quotation in this folder that still has a NULL
 * `project_id` to the supplied project. `updated_at` is deliberately
 * left alone so heal passes don't bump every row's "last edited"
 * timestamp — matches the policy of the original migration.
 */
export async function attachLooseQuotationsToProject(args: {
  folderId: number;
  projectId: number;
}): Promise<void> {
  const { folderId, projectId } = args;
  const q = sql();
  await q`
    update quotations
    set project_id = ${projectId}
    where folder_id = ${folderId}
      and project_id is null
      and deleted_at is null
  `;
  await q`
    update purchase_orders
    set project_id = ${projectId}
    where folder_id = ${folderId}
      and project_id is null
      and deleted_at is null
  `;
}

/**
 * Combo helper: ensure the folder has a default project AND every
 * loose quotation/PO is attached to it. Returns the project id (or
 * null if the folder is missing). Safe to call repeatedly — both
 * sub-helpers are idempotent.
 */
export async function ensureFolderProjectCoverage(args: {
  folderId: number;
  ownerId: number | null;
}): Promise<number | null> {
  const projectId = await ensureDefaultProject(args);
  if (projectId === null) return null;
  await attachLooseQuotationsToProject({
    folderId: args.folderId,
    projectId,
  });
  return projectId;
}
