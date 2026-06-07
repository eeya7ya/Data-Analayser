import { sql } from "./db";

/**
 * Cascade soft-delete / restore helpers.
 *
 * A client folder (and a company that owns folders) sits at the top of a
 * tree: folder → projects → {quotations, purchase orders, project files}
 * plus the leads filed against the folder/company/project. Soft-deleting
 * only the top row used to leave every child live — which is why a
 * deleted company's leads kept showing in the lead queue.
 *
 * These helpers stamp the whole subtree with the SAME `deleted_at`
 * timestamp as the parent, so:
 *   - the lead queue / lists (which all filter `deleted_at is null`)
 *     immediately stop showing orphaned children, and
 *   - a restore can re-light exactly the rows that went down together
 *     (matched on a ±2s window around the parent's timestamp) without
 *     resurrecting rows that were independently trashed earlier.
 *
 * Every statement guards on `deleted_at is null` so re-running is safe and
 * a child trashed on its own keeps its original timestamp.
 */

type Q = ReturnType<typeof sql>;

/** Soft-delete everything filed under a single client folder. */
export async function cascadeSoftDeleteFolder(
  q: Q,
  folderId: number,
  ts: string,
): Promise<void> {
  await q`
    update project_files set deleted_at = ${ts}
    where deleted_at is null
      and project_id in (select id from projects where folder_id = ${folderId})
  `;
  await q`
    update purchase_orders set deleted_at = ${ts}
    where deleted_at is null
      and (folder_id = ${folderId}
           or project_id in (select id from projects where folder_id = ${folderId}))
  `;
  await q`
    update leads set deleted_at = ${ts}, updated_at = now()
    where deleted_at is null and folder_id = ${folderId}
  `;
  await q`
    update quotations set deleted_at = ${ts}
    where deleted_at is null and folder_id = ${folderId}
  `;
  await q`
    update projects set deleted_at = ${ts}, updated_at = now()
    where deleted_at is null and folder_id = ${folderId}
  `;
}

/** Restore everything trashed alongside a folder (±2s of its timestamp). */
export async function cascadeRestoreFolder(
  q: Q,
  folderId: number,
  folderDeletedAt: string,
): Promise<void> {
  const lo = `${folderDeletedAt}`;
  await q`
    update projects set deleted_at = null, updated_at = now()
    where folder_id = ${folderId} and deleted_at is not null
      and deleted_at >= ${lo}::timestamptz - interval '2 seconds'
      and deleted_at <= ${lo}::timestamptz + interval '2 seconds'
  `;
  await q`
    update leads set deleted_at = null, updated_at = now()
    where folder_id = ${folderId} and deleted_at is not null
      and deleted_at >= ${lo}::timestamptz - interval '2 seconds'
      and deleted_at <= ${lo}::timestamptz + interval '2 seconds'
  `;
  await q`
    update quotations set deleted_at = null, updated_at = now()
    where folder_id = ${folderId} and deleted_at is not null
      and deleted_at >= ${lo}::timestamptz - interval '2 seconds'
      and deleted_at <= ${lo}::timestamptz + interval '2 seconds'
  `;
  await q`
    update purchase_orders set deleted_at = null, updated_at = now()
    where deleted_at is not null
      and (folder_id = ${folderId}
           or project_id in (select id from projects where folder_id = ${folderId}))
      and deleted_at >= ${lo}::timestamptz - interval '2 seconds'
      and deleted_at <= ${lo}::timestamptz + interval '2 seconds'
  `;
  await q`
    update project_files set deleted_at = null
    where deleted_at is not null
      and project_id in (select id from projects where folder_id = ${folderId})
      and deleted_at >= ${lo}::timestamptz - interval '2 seconds'
      and deleted_at <= ${lo}::timestamptz + interval '2 seconds'
  `;
}

/** Soft-delete a company's folders and their entire subtree. */
export async function cascadeSoftDeleteCompany(
  q: Q,
  companyId: number,
  ts: string,
): Promise<void> {
  await q`
    update project_files set deleted_at = ${ts}
    where deleted_at is null
      and project_id in (
        select p.id from projects p
        join client_folders cf on cf.id = p.folder_id
        where cf.company_id = ${companyId}
      )
  `;
  await q`
    update purchase_orders set deleted_at = ${ts}
    where deleted_at is null
      and (folder_id in (select id from client_folders where company_id = ${companyId})
           or project_id in (
             select p.id from projects p
             join client_folders cf on cf.id = p.folder_id
             where cf.company_id = ${companyId}
           ))
  `;
  // Leads can hang off the company directly (company_id) OR off one of its
  // folders (folder_id) — catch both.
  await q`
    update leads set deleted_at = ${ts}, updated_at = now()
    where deleted_at is null
      and (company_id = ${companyId}
           or folder_id in (select id from client_folders where company_id = ${companyId}))
  `;
  await q`
    update quotations set deleted_at = ${ts}
    where deleted_at is null
      and folder_id in (select id from client_folders where company_id = ${companyId})
  `;
  await q`
    update projects set deleted_at = ${ts}, updated_at = now()
    where deleted_at is null
      and folder_id in (select id from client_folders where company_id = ${companyId})
  `;
  await q`
    update client_folders set deleted_at = ${ts}, updated_at = now()
    where deleted_at is null and company_id = ${companyId}
  `;
}

/** Restore a company's subtree trashed within ±2s of its timestamp. */
export async function cascadeRestoreCompany(
  q: Q,
  companyId: number,
  companyDeletedAt: string,
): Promise<void> {
  const lo = `${companyDeletedAt}`;
  await q`
    update client_folders set deleted_at = null, updated_at = now()
    where company_id = ${companyId} and deleted_at is not null
      and deleted_at >= ${lo}::timestamptz - interval '2 seconds'
      and deleted_at <= ${lo}::timestamptz + interval '2 seconds'
  `;
  await q`
    update projects set deleted_at = null, updated_at = now()
    where folder_id in (select id from client_folders where company_id = ${companyId})
      and deleted_at is not null
      and deleted_at >= ${lo}::timestamptz - interval '2 seconds'
      and deleted_at <= ${lo}::timestamptz + interval '2 seconds'
  `;
  await q`
    update leads set deleted_at = null, updated_at = now()
    where (company_id = ${companyId}
           or folder_id in (select id from client_folders where company_id = ${companyId}))
      and deleted_at is not null
      and deleted_at >= ${lo}::timestamptz - interval '2 seconds'
      and deleted_at <= ${lo}::timestamptz + interval '2 seconds'
  `;
  await q`
    update quotations set deleted_at = null, updated_at = now()
    where folder_id in (select id from client_folders where company_id = ${companyId})
      and deleted_at is not null
      and deleted_at >= ${lo}::timestamptz - interval '2 seconds'
      and deleted_at <= ${lo}::timestamptz + interval '2 seconds'
  `;
  await q`
    update purchase_orders set deleted_at = null
    where deleted_at is not null
      and (folder_id in (select id from client_folders where company_id = ${companyId})
           or project_id in (
             select p.id from projects p
             join client_folders cf on cf.id = p.folder_id
             where cf.company_id = ${companyId}
           ))
      and deleted_at >= ${lo}::timestamptz - interval '2 seconds'
      and deleted_at <= ${lo}::timestamptz + interval '2 seconds'
  `;
  await q`
    update project_files set deleted_at = null
    where deleted_at is not null
      and project_id in (
        select p.id from projects p
        join client_folders cf on cf.id = p.folder_id
        where cf.company_id = ${companyId}
      )
      and deleted_at >= ${lo}::timestamptz - interval '2 seconds'
      and deleted_at <= ${lo}::timestamptz + interval '2 seconds'
  `;
}
