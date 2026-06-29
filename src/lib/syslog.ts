import { sql } from "./db";

/**
 * System activity log ("Syslog").
 *
 * Every meaningful user action records a row in the `syslog` table (the
 * former `activity_log`). The admin console surfaces it as one
 * chronological feed of who did what. The log is kept to a rolling
 * one-month window: `pruneSyslog()` drops anything older than a month and
 * is called every time the admin opens the log, so the log effectively
 * "resets every month" without a scheduled job. Admins can also wipe it
 * on demand with `resetSyslog()`.
 *
 * The window is one month. The prune query below uses a fixed
 * `interval '1 month'` literal; this constant exists for the UI copy.
 */
export const SYSLOG_RETENTION_LABEL = "1 month";

export interface SyslogEntry {
  id: number;
  actorId: number | null;
  actorName: string;
  verb: string;
  entityType: string;
  entityId: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

/**
 * Append one row. Fire-and-forget by design: a slow or failing log write
 * must never block (or fail) the user action that triggered it, so the
 * caller can `void recordSyslog(...)` and move on. Errors are swallowed.
 */
export async function recordSyslog(entry: {
  actorId: number | null;
  ownerId?: number | null;
  entityType: string;
  entityId: number;
  verb: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const q = sql();
    await q`
      insert into syslog (owner_id, actor_id, entity_type, entity_id, verb, meta_json)
      values (
        ${entry.ownerId ?? null}, ${entry.actorId}, ${entry.entityType},
        ${entry.entityId}, ${entry.verb},
        ${JSON.stringify(entry.meta ?? {})}::jsonb
      )
    `;
  } catch {
    // Never let audit logging break the request that triggered it.
  }
}

/** Delete entries older than the retention window. Returns rows removed. */
export async function pruneSyslog(): Promise<number> {
  const q = sql();
  const rows = (await q`
    delete from syslog
    where created_at < now() - interval '1 month'
    returning id
  `) as Array<{ id: number }>;
  return rows.length;
}

/** Wipe the entire log (manual admin reset). Returns rows removed. */
export async function resetSyslog(): Promise<number> {
  const q = sql();
  const rows = (await q`delete from syslog returning id`) as Array<{
    id: number;
  }>;
  return rows.length;
}

/**
 * Read the most recent entries (after pruning), newest first, with the
 * actor's display name resolved. `limit` is clamped to a sane maximum.
 */
export async function listSyslog(limit = 200): Promise<SyslogEntry[]> {
  const capped = Math.max(1, Math.min(limit, 1000));
  const q = sql();
  const rows = (await q`
    select s.id, s.actor_id, s.verb, s.entity_type, s.entity_id,
           s.meta_json, s.created_at,
           coalesce(nullif(u.display_name, ''), u.username, 'System') as actor_name
    from syslog s
    left join users u on u.id = s.actor_id
    order by s.created_at desc, s.id desc
    limit ${capped}
  `) as Array<{
    id: number;
    actor_id: number | null;
    verb: string;
    entity_type: string;
    entity_id: string | number;
    meta_json: Record<string, unknown> | null;
    created_at: string;
    actor_name: string;
  }>;
  return rows.map((r) => ({
    id: Number(r.id),
    actorId: r.actor_id === null ? null : Number(r.actor_id),
    actorName: r.actor_name,
    verb: r.verb,
    entityType: r.entity_type,
    entityId: String(r.entity_id),
    meta: r.meta_json ?? {},
    createdAt: r.created_at,
  }));
}
