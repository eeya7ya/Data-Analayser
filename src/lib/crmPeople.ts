import { sql } from "@/lib/db";

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
 * company. Won't reuse a same-named folder that belongs to a different
 * company; if the user's namespace already has that name elsewhere,
 * we suffix with " (2)", " (3)", … until we find a free slot.
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

  const existing = (await q`
    select id from client_folders
    where owner_id = ${ownerId}
      and company_id = ${companyId}
      and lower(name) = lower(${baseName})
      and deleted_at is null
    limit 1
  `) as Array<{ id: number }>;
  if (existing.length > 0) return existing[0].id;

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
    if (inserted.length > 0) return inserted[0].id;
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
}
