import { sql } from "@/lib/db";

/**
 * V1.3a de-duplication rule: a client name may live in the Individual
 * list OR the Company list — never both. "Companies" are rows in the
 * `companies` table; "Individuals" are `client_folders` with
 * `kind = 'individual'`. Creating one is hard-blocked when a row with
 * the same (case-insensitive) name already exists in the other list.
 *
 * Scope follows visibility: non-admins only collide with their own
 * rows; admins (ownerId = null) collide globally, since they see and
 * own the whole dataset.
 */

export type CrmEntityKind = "company" | "individual";

export interface NameConflict {
  id: number;
  name: string;
  kind: CrmEntityKind;
}

/**
 * Returns rows in the *opposite* list that share `name`. An empty array
 * means the name is free to use for `target`.
 */
export async function findCrossKindConflicts(args: {
  name: string;
  target: CrmEntityKind;
  ownerId: number | null;
}): Promise<NameConflict[]> {
  const name = args.name.trim();
  if (!name) return [];
  const q = sql();
  const owner = args.ownerId;

  if (args.target === "company") {
    // Creating a company → collide with existing individuals.
    const rows = (await q`
      select id, name from client_folders
      where deleted_at is null
        and kind = 'individual'
        and lower(name) = lower(${name})
        and (${owner}::int is null or owner_id = ${owner})
      limit 5
    `) as Array<{ id: number; name: string }>;
    return rows.map((r) => ({ id: r.id, name: r.name, kind: "individual" as const }));
  }

  // Creating an individual → collide with existing companies.
  const rows = (await q`
    select id, name from companies
    where deleted_at is null
      and lower(name) = lower(${name})
      and (${owner}::int is null or owner_id = ${owner})
    limit 5
  `) as Array<{ id: number; name: string }>;
  return rows.map((r) => ({ id: r.id, name: r.name, kind: "company" as const }));
}
