import { sql } from "@/lib/db";
import { ensureFolderProjectCoverage } from "@/lib/projects";

/**
 * The CRM treats "a person at a company" and "a client folder under
 * that company" as the same thing. Each contact row owns exactly one
 * client_folder where its projects/quotations live, and clicking the
 * person on the company page drills straight into that folder.
 *
 * Pre-merge data — contacts created without a folder, and "+ New
 * client" folders created without a contact — gets reconciled here so
 * the unified list never hides anyone.
 */

/**
 * Idempotently get-or-create a project folder for a person at a
 * company. Resolution order:
 *   1. A folder owned by this user, named the same, already attached to
 *      this company → reuse it.
 *   2. A same-named unfiled folder owned by this user (company_id is
 *      null) → adopt it by attaching it to this company. Keeps the
 *      folder's existing projects + quotations in place instead of
 *      stranding them under "Unfiled" while a new empty duplicate is
 *      created at the company.
 *   3. Otherwise insert a new folder, suffixing " (2)", " (3)", … until
 *      we find a free slot in the user's namespace.
 */
export async function ensurePersonFolder(args: {
  ownerId: number;
  companyId: number;
  baseName: string;
  email: string | null;
  phone: string | null;
}): Promise<number | null> {
  const { ownerId, companyId, baseName, email, phone } = args;
  const q = sql();

  const sameCompany = (await q`
    select id from client_folders
    where owner_id = ${ownerId}
      and company_id = ${companyId}
      and lower(name) = lower(${baseName})
      and deleted_at is null
    limit 1
  `) as Array<{ id: number }>;
  if (sameCompany.length > 0) {
    await ensureFolderProjectCoverage({
      folderId: sameCompany[0].id,
      ownerId,
    });
    return sameCompany[0].id;
  }

  // Adopt an unfiled same-named folder so its projects and quotations
  // come along to the company instead of being orphaned. We deliberately
  // only adopt folders with company_id IS NULL — moving a folder away
  // from a different company would be a data heist, not a reconciliation.
  const adoptable = (await q`
    select id from client_folders
    where owner_id = ${ownerId}
      and lower(name) = lower(${baseName})
      and deleted_at is null
      and company_id is null
    limit 1
  `) as Array<{ id: number }>;
  if (adoptable.length > 0) {
    await q`
      update client_folders
      set company_id   = ${companyId},
          kind         = 'company',
          client_email = coalesce(client_email, ${email}),
          client_phone = coalesce(client_phone, ${phone}),
          updated_at   = now()
      where id = ${adoptable[0].id}
    `;
    await ensureFolderProjectCoverage({
      folderId: adoptable[0].id,
      ownerId,
    });
    return adoptable[0].id;
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? baseName : `${baseName} (${attempt + 1})`;
    const inserted = (await q`
      insert into client_folders (name, owner_id, client_email, client_phone,
                                  kind, company_id)
      values (${candidate}, ${ownerId}, ${email}, ${phone},
              'company', ${companyId})
      on conflict (owner_id, name) do nothing
      returning id
    `) as Array<{ id: number }>;
    if (inserted.length > 0) {
      await ensureFolderProjectCoverage({
        folderId: inserted[0].id,
        ownerId,
      });
      return inserted[0].id;
    }
  }
  return null;
}

export async function syncCompanyPeopleAndFolders(args: {
  companyId: number;
  userId: number;
  isAdmin: boolean;
}): Promise<void> {
  const { companyId, userId, isAdmin } = args;
  const q = sql();
  const ownerFilter = isAdmin ? null : userId;

  // Heal pre-existing duplicates created by the old ensurePersonFolder
  // before adoption was added. If a contact at this company points to an
  // "X (2)" / "X (3)" folder while a same-owner unfiled folder named
  // "X" exists, move everything filed on the duplicate (projects,
  // quotations, purchase orders) onto the original, swap the contact
  // onto the original, attach the original to this company, and
  // soft-delete the now-empty duplicate. Merging is unconditional —
  // the "(N)" suffix pattern is only ever produced by the system, so
  // there's nothing on the duplicate the user authored from scratch.
  const duplicateContacts = (await q`
    select c.id as contact_id, c.owner_id, c.folder_id,
           cf.name as folder_name
    from contacts c
    join client_folders cf on cf.id = c.folder_id
    where c.company_id = ${companyId}
      and c.deleted_at is null
      and cf.deleted_at is null
      and cf.name ~ ' \\(\\d+\\)$'
      and (${ownerFilter}::int is null or c.owner_id = ${ownerFilter})
  `) as Array<{
    contact_id: number;
    owner_id: number | null;
    folder_id: number;
    folder_name: string;
  }>;
  for (const dup of duplicateContacts) {
    const baseName = dup.folder_name.replace(/\s*\(\d+\)$/, "");
    if (!baseName) continue;
    const original = (await q`
      select id from client_folders
      where owner_id = ${dup.owner_id}
        and lower(name) = lower(${baseName})
        and deleted_at is null
        and company_id is null
        and id <> ${dup.folder_id}
      limit 1
    `) as Array<{ id: number }>;
    if (original.length === 0) continue;
    // Reparent every child row in one pass so quotation.folder_id and
    // its project.folder_id stay consistent — moving quotations without
    // moving their projects would leave the project_id pointing into
    // the trashed duplicate.
    await q`
      update projects
      set folder_id = ${original[0].id}
      where folder_id = ${dup.folder_id} and deleted_at is null
    `;
    await q`
      update quotations
      set folder_id = ${original[0].id}
      where folder_id = ${dup.folder_id} and deleted_at is null
    `;
    await q`
      update purchase_orders
      set folder_id = ${original[0].id}
      where folder_id = ${dup.folder_id} and deleted_at is null
    `;
    await q`
      update client_folders
      set company_id = ${companyId},
          kind       = 'company',
          updated_at = now()
      where id = ${original[0].id}
    `;
    await q`
      update contacts
      set folder_id  = ${original[0].id},
          updated_at = now()
      where id = ${dup.contact_id}
    `;
    await q`
      update client_folders
      set deleted_at = now(), updated_at = now()
      where id = ${dup.folder_id}
    `;
    await ensureFolderProjectCoverage({
      folderId: original[0].id,
      ownerId: dup.owner_id,
    });
  }

  // Contacts whose folder_id is null OR points at a missing/archived
  // folder — give them a fresh project folder named after the person.
  const orphanContacts = (await q`
    select c.id, c.first_name, c.last_name, c.email, c.phone, c.owner_id
    from contacts c
    where c.company_id = ${companyId}
      and c.deleted_at is null
      and (${ownerFilter}::int is null or c.owner_id = ${ownerFilter})
      and (
        c.folder_id is null
        or not exists (
          select 1 from client_folders cf
          where cf.id = c.folder_id and cf.deleted_at is null
        )
      )
  `) as Array<{
    id: number;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    owner_id: number | null;
  }>;
  for (const oc of orphanContacts) {
    const name =
      [oc.first_name, oc.last_name].filter(Boolean).join(" ").trim() ||
      oc.email ||
      oc.phone ||
      `Contact #${oc.id}`;
    const folderId = await ensurePersonFolder({
      ownerId: oc.owner_id ?? userId,
      companyId,
      baseName: name,
      email: oc.email,
      phone: oc.phone,
    });
    if (folderId !== null) {
      await q`update contacts set folder_id = ${folderId} where id = ${oc.id}`;
    }
  }

  // Heal the folder `kind` / `company_id` for every contact at this
  // company. The contact's company_id is the canonical truth — if the
  // person is listed at a company, their folder must be kind='company'
  // with the matching company_id, otherwise it leaks into
  // /crm/individual or stays stranded under "unfiled" while still
  // surfacing under the company page (the cross-contamination the user
  // was seeing).
  await q`
    update client_folders cf
    set kind       = 'company',
        company_id = ${companyId},
        updated_at = now()
    from contacts ct
    where ct.folder_id = cf.id
      and ct.company_id = ${companyId}
      and ct.deleted_at is null
      and cf.deleted_at is null
      and (cf.kind is distinct from 'company' or cf.company_id is distinct from ${companyId})
      and (${ownerFilter}::int is null or ct.owner_id = ${ownerFilter})
  `;

  // Folders at this company with no live contact pointing at them —
  // mint a placeholder contact so the merged "People" list surfaces
  // every legacy "+ New client" row too.
  const orphanFolders = (await q`
    select cf.id, cf.name, cf.client_email, cf.client_phone, cf.owner_id
    from client_folders cf
    where cf.company_id = ${companyId}
      and cf.deleted_at is null
      and (${ownerFilter}::int is null or cf.owner_id = ${ownerFilter})
      and not exists (
        select 1 from contacts c
        where c.folder_id = cf.id and c.deleted_at is null
      )
  `) as Array<{
    id: number;
    name: string;
    client_email: string | null;
    client_phone: string | null;
    owner_id: number | null;
  }>;
  for (const ofRow of orphanFolders) {
    const parts = (ofRow.name ?? "").trim().split(/\s+/);
    const firstName = parts[0] || null;
    const lastName = parts.slice(1).join(" ") || null;
    await q`
      insert into contacts (owner_id, company_id, folder_id,
                            first_name, last_name, email, phone)
      values (${ofRow.owner_id ?? userId}, ${companyId}, ${ofRow.id},
              ${firstName}, ${lastName},
              ${ofRow.client_email}, ${ofRow.client_phone})
    `;
  }

  // A company with no people is left empty on purpose — the company
  // page shows an empty clients list with "+ New contact" so the user
  // adds real clients themselves, instead of us minting a placeholder
  // named after the company (which read as a confusing self-duplicate).
}
