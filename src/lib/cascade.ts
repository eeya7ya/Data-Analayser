import { sql } from "./db";

/**
 * Cascade soft-delete / restore helpers.
 *
 * A client folder (and a company that owns folders) sits at the top of a
 * tree: folder → projects → {quotations, purchase orders, project files}.
 * These helpers stamp the whole subtree with the SAME `deleted_at`
 * timestamp as the parent, so:
 *   - the lists (which all filter `deleted_at is null`) immediately stop
 *     showing orphaned children, and
 *   - a restore can re-light exactly the rows that went down together
 *     (matched on a ±2s window around the parent's timestamp) without
 *     resurrecting rows that were independently trashed earlier.
 *
 * Every statement guards on `deleted_at is null` so re-running is safe and
 * a child trashed on its own keeps its original timestamp.
 *
 * LEADS ARE THE EXCEPTION. A presales lead is a durable work item that
 * lives in the shared presales queue on its OWN lifecycle (claim → work →
 * complete / junk). It is not "owned" by the sales-side client/project it
 * was opened against, so a sales user removing that project, client, or
 * company must NOT yank the lead out from under presales — the old cascade
 * that soft-deleted leads here was a destructive "dead link". Instead we
 * DETACH: the lead stays live in the queue and we null only the references
 * that just went away, so it carries accurate (empty), not dangling, links
 * and presales can re-file it under a live tree.
 */

type Q = ReturnType<typeof sql>;

/**
 * Inclusive ±`ms` ISO bounds around a timestamp, for the restore window.
 * Backend-agnostic: Postgres `interval` arithmetic doesn't exist on D1/SQLite,
 * and `deleted_at` is always written as an ISO string (new Date().toISOString()),
 * so comparing against ISO bounds is correct on both backends. Falls back to an
 * exact match if the timestamp can't be parsed.
 */
function isoWindow(at: string, ms: number): { lo: string; hi: string } {
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) return { lo: at, hi: at };
  return {
    lo: new Date(t - ms).toISOString(),
    hi: new Date(t + ms).toISOString(),
  };
}

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
  // Detach — don't delete — any lead filed under (or opened against) this
  // folder. The lead survives in the presales queue; only the links that just
  // went away are cleared. The company_id is left intact when it points at a
  // company that still exists (a folder-only delete).
  await q`
    update leads set
      folder_id = case when folder_id = ${folderId} then null else folder_id end,
      project_id = case
        when project_id in (select id from projects where folder_id = ${folderId})
        then null else project_id end,
      sales_project_id = case
        when sales_project_id in (select id from projects where folder_id = ${folderId})
        then null else sales_project_id end,
      updated_at = now()
    where deleted_at is null
      and (folder_id = ${folderId}
           or project_id in (select id from projects where folder_id = ${folderId})
           or sales_project_id in (select id from projects where folder_id = ${folderId}))
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

/**
 * Permanently delete everything filed under a single client folder — the hard
 * counterpart of cascadeSoftDeleteFolder. Leads are DETACHED (kept live in the
 * presales queue), never deleted, exactly as in the soft cascade. Everything
 * else under the folder is removed regardless of prior trash state, so nothing
 * is recoverable afterwards.
 */
export async function cascadeHardDeleteFolder(
  q: Q,
  folderId: number,
): Promise<void> {
  // Detach — never delete — any lead filed under (or opened against) this
  // folder. The lead survives in the presales queue; only the dead links go.
  await q`
    update leads set
      folder_id = case when folder_id = ${folderId} then null else folder_id end,
      project_id = case
        when project_id in (select id from projects where folder_id = ${folderId})
        then null else project_id end,
      sales_project_id = case
        when sales_project_id in (select id from projects where folder_id = ${folderId})
        then null else sales_project_id end,
      updated_at = now()
    where folder_id = ${folderId}
       or project_id in (select id from projects where folder_id = ${folderId})
       or sales_project_id in (select id from projects where folder_id = ${folderId})
  `;
  await q`
    delete from project_files
    where project_id in (select id from projects where folder_id = ${folderId})
  `;
  await q`
    delete from purchase_orders
    where folder_id = ${folderId}
       or project_id in (select id from projects where folder_id = ${folderId})
  `;
  await q`delete from quotations where folder_id = ${folderId}`;
  await q`delete from projects where folder_id = ${folderId}`;
}

/** Restore everything trashed alongside a folder (±2s of its timestamp). */
export async function cascadeRestoreFolder(
  q: Q,
  folderId: number,
  folderDeletedAt: string,
): Promise<void> {
  const win = isoWindow(`${folderDeletedAt}`, 2000);
  await q`
    update projects set deleted_at = null, updated_at = now()
    where folder_id = ${folderId} and deleted_at is not null
      and deleted_at >= ${win.lo}
      and deleted_at <= ${win.hi}
  `;
  // Leads are intentionally NOT restored here: they were never trashed with
  // the folder (they were detached and kept live), so there is nothing to
  // re-light. Their links stay severed — presales re-files them under a live
  // tree if the work is still relevant.
  await q`
    update quotations set deleted_at = null, updated_at = now()
    where folder_id = ${folderId} and deleted_at is not null
      and deleted_at >= ${win.lo}
      and deleted_at <= ${win.hi}
  `;
  await q`
    update purchase_orders set deleted_at = null, updated_at = now()
    where deleted_at is not null
      and (folder_id = ${folderId}
           or project_id in (select id from projects where folder_id = ${folderId}))
      and deleted_at >= ${win.lo}
      and deleted_at <= ${win.hi}
  `;
  await q`
    update project_files set deleted_at = null
    where deleted_at is not null
      and project_id in (select id from projects where folder_id = ${folderId})
      and deleted_at >= ${win.lo}
      and deleted_at <= ${win.hi}
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
  // Detach — don't delete — every lead anchored anywhere in this company's
  // subtree (directly via company_id, via one of its folders, or via a
  // project under one of those folders). The whole company is going away, so
  // each reference is cleared; the lead stays live in the presales queue.
  await q`
    update leads set
      company_id = case when company_id = ${companyId} then null else company_id end,
      folder_id = case
        when folder_id in (select id from client_folders where company_id = ${companyId})
        then null else folder_id end,
      project_id = case
        when project_id in (
          select p.id from projects p
          join client_folders cf on cf.id = p.folder_id
          where cf.company_id = ${companyId}
        ) then null else project_id end,
      sales_project_id = case
        when sales_project_id in (
          select p.id from projects p
          join client_folders cf on cf.id = p.folder_id
          where cf.company_id = ${companyId}
        ) then null else sales_project_id end,
      updated_at = now()
    where deleted_at is null
      and (company_id = ${companyId}
           or folder_id in (select id from client_folders where company_id = ${companyId})
           or project_id in (
             select p.id from projects p
             join client_folders cf on cf.id = p.folder_id
             where cf.company_id = ${companyId})
           or sales_project_id in (
             select p.id from projects p
             join client_folders cf on cf.id = p.folder_id
             where cf.company_id = ${companyId}))
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
  const win = isoWindow(`${companyDeletedAt}`, 2000);
  await q`
    update client_folders set deleted_at = null, updated_at = now()
    where company_id = ${companyId} and deleted_at is not null
      and deleted_at >= ${win.lo}
      and deleted_at <= ${win.hi}
  `;
  await q`
    update projects set deleted_at = null, updated_at = now()
    where folder_id in (select id from client_folders where company_id = ${companyId})
      and deleted_at is not null
      and deleted_at >= ${win.lo}
      and deleted_at <= ${win.hi}
  `;
  // Leads were detached, not trashed, when the company went down (see
  // cascadeSoftDeleteCompany) — there is nothing to restore here.
  await q`
    update quotations set deleted_at = null, updated_at = now()
    where folder_id in (select id from client_folders where company_id = ${companyId})
      and deleted_at is not null
      and deleted_at >= ${win.lo}
      and deleted_at <= ${win.hi}
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
      and deleted_at >= ${win.lo}
      and deleted_at <= ${win.hi}
  `;
  await q`
    update project_files set deleted_at = null
    where deleted_at is not null
      and project_id in (
        select p.id from projects p
        join client_folders cf on cf.id = p.folder_id
        where cf.company_id = ${companyId}
      )
      and deleted_at >= ${win.lo}
      and deleted_at <= ${win.hi}
  `;
}

/**
 * Detach (never delete) any presales lead tied to a single project that is
 * being soft-deleted. Mirrors the folder/company cascades: the lead stays
 * live in the queue and only its project links are severed — the client
 * folder it sits under is untouched, so presales can re-file it under another
 * project of the same client.
 */
export async function detachLeadsFromProject(
  q: Q,
  projectId: number,
): Promise<void> {
  await q`
    update leads set
      project_id = case when project_id = ${projectId} then null else project_id end,
      sales_project_id = case when sales_project_id = ${projectId} then null else sales_project_id end,
      updated_at = now()
    where deleted_at is null
      and (project_id = ${projectId} or sales_project_id = ${projectId})
  `;
}
