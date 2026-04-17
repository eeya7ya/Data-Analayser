import type { Sql } from "postgres";

/**
 * Cross-module helpers that keep the Quotations + CRM surfaces in lock-step.
 *
 * These helpers are purely additive: they only ever CREATE new company rows
 * or SET a null-valued pointer. They never delete data, never overwrite a
 * field that already has a value, and always run inside the caller's
 * transaction-mode pooled connection so a failure in one helper cascades
 * cleanly back to the API handler.
 */

/**
 * Resolve (or lazily create) the CRM company for a quotation/folder.
 *
 * Preference order:
 *   1. An existing `companies` row linked to `folderId`.
 *   2. An existing `companies` row owned by the user whose lower(name)
 *      matches the quotation's client_name.
 *   3. A brand-new `companies` row created from the folder name (preferred)
 *      or falling back to client_name. The new row is linked to the folder
 *      via `companies.folder_id` so future lookups short-circuit in (1).
 *
 * Returns `null` only when there is no folder AND no usable client_name —
 * i.e. the caller literally has nothing to file under, which is fine: the
 * column is nullable.
 */
export async function resolveCompanyForQuotation(
  q: Sql,
  args: {
    ownerId: number;
    folderId: number | null;
    clientName: string | null;
    clientEmail: string | null;
    clientPhone: string | null;
  },
): Promise<number | null> {
  const { ownerId, folderId, clientName, clientEmail, clientPhone } = args;

  // Path 1 — folder-driven lookup. If the folder already owns a CRM
  // company we just reuse it. This is the 99% path for anyone who has
  // already been using the folders UI.
  if (folderId) {
    const existing = (await q`
      select id from companies
      where folder_id = ${folderId} and deleted_at is null
      order by id asc
      limit 1
    `) as Array<{ id: number }>;
    if (existing[0]) return existing[0].id;

    // No company yet — mint one from the folder record. We pull the name
    // from the folder itself (that's the authoritative client label).
    const folderRows = (await q`
      select name, client_email, client_phone, client_company
      from client_folders
      where id = ${folderId}
      limit 1
    `) as Array<{
      name: string;
      client_email: string | null;
      client_phone: string | null;
      client_company: string | null;
    }>;
    const folder = folderRows[0];
    const name =
      (folder?.name && folder.name.trim()) ||
      (clientName && clientName.trim()) ||
      "Client";
    const notes = folder?.client_company ?? null;
    const created = (await q`
      insert into companies (owner_id, folder_id, name, notes)
      values (${ownerId}, ${folderId}, ${name}, ${notes})
      returning id
    `) as Array<{ id: number }>;
    return created[0]?.id ?? null;
  }

  // Path 2 — no folder, but we have a client name. Match case-insensitively
  // against the user's existing companies so two "Acme Corp" quotations
  // written at different times collapse onto the same CRM account.
  const cn = (clientName ?? "").trim();
  if (!cn) return null;

  const match = (await q`
    select id from companies
    where owner_id = ${ownerId}
      and deleted_at is null
      and lower(name) = ${cn.toLowerCase()}
    order by id asc
    limit 1
  `) as Array<{ id: number }>;
  if (match[0]) return match[0].id;

  // Path 3 — brand-new company from scratch. No folder link (the caller
  // didn't give us one).
  const notes =
    [clientEmail, clientPhone].filter((v) => v && v.trim()).join(" · ") ||
    null;
  const created = (await q`
    insert into companies (owner_id, folder_id, name, notes)
    values (${ownerId}, null, ${cn}, ${notes})
    returning id
  `) as Array<{ id: number }>;
  return created[0]?.id ?? null;
}

/**
 * When a folder's contact card is edited, mirror the change onto any CRM
 * company that is already linked to the folder. Only fills empty fields
 * so we never stomp on CRM edits the user has made separately.
 */
export async function syncCompanyFromFolder(
  q: Sql,
  folderId: number,
): Promise<void> {
  await q`
    update companies c
    set notes = coalesce(c.notes, f.client_company),
        name  = case
                  when nullif(trim(c.name), '') is null
                    then coalesce(nullif(trim(f.name), ''), c.name)
                  else c.name
                end,
        updated_at = now()
    from client_folders f
    where c.folder_id = f.id
      and c.deleted_at is null
      and f.id = ${folderId}
  `;
}
