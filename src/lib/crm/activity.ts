import { sql } from "@/lib/db";

export type CrmEntityType =
  | "contact"
  | "company"
  | "deal"
  | "task"
  | "note"
  | "quotation"
  | "folder";

/**
 * Append a row to activity_log. Every CRM write path calls this so Contact
 * 360° timelines, deal histories and dashboards can be built from a single
 * source of truth. Failures are swallowed — an audit-log write must never
 * break the user-facing operation that triggered it.
 */
export async function logActivity(args: {
  ownerId: number | null;
  actorId: number | null;
  entityType: CrmEntityType;
  entityId: number | bigint;
  verb: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const q = sql();
    const meta = JSON.stringify(args.meta ?? {});
    await q`
      insert into activity_log (owner_id, actor_id, entity_type, entity_id, verb, meta_json)
      values (${args.ownerId}, ${args.actorId}, ${args.entityType}, ${args.entityId as number}, ${args.verb}, ${meta}::jsonb)
    `;
  } catch {
    // intentionally swallowed
  }
}
