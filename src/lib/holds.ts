import { sql } from "@/lib/db";
import { sendPushToUsers } from "@/lib/push";

/**
 * V1.3D — "Held for Execution" transfer mechanics.
 *
 * A salesperson marks an approved quotation Held for Execution and
 * optionally sets `hold_transfer_at`. When that time passes the deal must
 * move to the projects team. The repo has no cron, so we transfer in two
 * ways that share this code:
 *
 *   • Manual  — sales clicks "Transfer now" (POST /api/quotations/transfer-hold).
 *   • Auto    — `sweepDueHolds` promotes every overdue hold. It's called
 *               lazily from the sales-pipeline list and the dashboard, and
 *               is also reachable via POST /api/quotations/sweep-holds so a
 *               real scheduler can be wired in later without code changes.
 *
 * Both paths create a `project_handoffs` row (status pending_assignment)
 * exactly like the manual convert flow, then stamp `transferred_at` so the
 * Won bucket reflects it and the sweep never double-transfers.
 */

type Q = ReturnType<typeof sql>;

interface HeldQuotation {
  id: number;
  owner_id: number | null;
  ref: string;
  project_name: string;
  client_name: string | null;
  client_phone: string | null;
  items_json: unknown;
  folder_id: number | null;
  project_id: number | null;
  approved_at: string | null;
  transferred_at: string | null;
  sales_outcome: string | null;
}

/**
 * Create a project handoff from a held quotation and stamp
 * `transferred_at`. No-ops (returns null) when the quotation isn't held,
 * isn't approved, or was already transferred — so it's safe to call from
 * both the manual button and the idempotent sweep. `actorId` is the user
 * who triggered it, or null for an automatic sweep (we then attribute the
 * audit entry to the quotation owner).
 */
export async function transferHeldQuotation(
  q: Q,
  quotationId: number,
  actorId: number | null,
): Promise<number | null> {
  const rows = (await q`
    select id, owner_id, ref, project_name, client_name, client_phone,
           items_json, folder_id, project_id, approved_at,
           transferred_at, sales_outcome
    from quotations
    where id = ${quotationId} and deleted_at is null
    limit 1
  `) as HeldQuotation[];
  if (rows.length === 0) return null;
  const quotation = rows[0];
  if (quotation.sales_outcome !== "held") return null;
  if (quotation.transferred_at) return null;
  if (!quotation.approved_at) return null;

  const actor = actorId ?? quotation.owner_id;
  const boqSnapshot = JSON.stringify(
    Array.isArray(quotation.items_json) ? quotation.items_json : [],
  );

  const inserted = (await q`
    insert into project_handoffs
      (quotation_id, project_id, folder_id, created_by, contact_name,
       contact_phones, priority, notes, boq_snapshot)
    values
      (${quotation.id}, ${quotation.project_id}, ${quotation.folder_id},
       ${actor}, ${quotation.client_name}, ${quotation.client_phone},
       'normal', ${`Transferred from held quotation ${quotation.ref}`},
       ${boqSnapshot}::jsonb)
    returning id
  `) as Array<{ id: number }>;
  const handoffId = inserted[0].id;

  await q`
    update quotations
    set transferred_at = now(), updated_at = now()
    where id = ${quotation.id}
  `;
  await q`
    insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
    values (${actor}, 'project_handoff', ${handoffId}, 'create',
            ${JSON.stringify({
              quotation_id: quotation.id,
              ref: quotation.ref,
              via: actorId ? "hold_transfer_manual" : "hold_transfer_auto",
            })}::jsonb)
  `;

  // Heads-up to whoever assigns handoffs: projects managers + admins.
  const managers = (await q`
    select user_id from user_module_roles
    where module = 'projects' and role = 'manager' and revoked_at is null
    union
    select id as user_id from users where role = 'admin'
  `) as Array<{ user_id: number }>;
  const ids = managers.map((m) => m.user_id).filter((n) => Number.isFinite(n));
  if (ids.length > 0) {
    void sendPushToUsers(ids, {
      title: "New project awaiting assignment",
      body: `${quotation.ref} was transferred from sales — assign a project member.`,
      url: "/projects/handoffs",
      tag: `handoff-${handoffId}`,
    });
  }

  return handoffId;
}

/**
 * Promote every held quotation whose scheduled transfer time has passed.
 * Cheap on the happy path thanks to the `quotations_hold_due_idx` partial
 * index. Returns the number of quotations transferred.
 */
export async function sweepDueHolds(q: Q): Promise<number> {
  const due = (await q`
    select id from quotations
    where sales_outcome = 'held'
      and transferred_at is null
      and hold_transfer_at is not null
      and hold_transfer_at <= now()
      and approved_at is not null
      and deleted_at is null
    limit 100
  `) as Array<{ id: number }>;

  let transferred = 0;
  for (const row of due) {
    const handoffId = await transferHeldQuotation(q, row.id, null);
    if (handoffId) transferred++;
  }
  return transferred;
}
