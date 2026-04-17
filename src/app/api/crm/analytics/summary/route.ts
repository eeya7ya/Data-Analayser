import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";
import { getOrSet } from "@/lib/cache";

export const runtime = "nodejs";

/**
 * Dashboard summary — a single SQL round-trip.
 *
 * The previous version fired nine queries via `Promise.all`. With
 * postgres.js `max: 1` those nine calls serialised on one socket, and even
 * at `max: 3` it's three RTTs minimum. Under the Supabase transaction
 * pooler each round-trip is 150–400 ms, so a cold-start dashboard hit
 * easily spent 2–4 s on network latency alone before the query planner
 * did any real work — the exact shape that made the CRM dashboard time
 * out with "Request timed out — please retry."
 *
 * Everything the dashboard needs now ships in a single `json_build_object`
 * SELECT. Scalar aggregates are correlated subqueries (count/sum); the
 * three arrays (stages / daily_deals / activity) are built with
 * `json_agg` over inline subqueries. One round-trip, one query plan, one
 * prepared-ish pass through the pooler. Result is cached per-user for 30s
 * via the in-process coalescing cache so warm lambdas skip the DB
 * entirely.
 */

interface SummaryPayload {
  counts: { contacts: number; companies: number; deals: number; tasks_open: number };
  pipeline_value: number;
  won_value: number;
  stages: {
    stage_id: number;
    name: string;
    position: number;
    is_won: boolean;
    is_lost: boolean;
    count: number;
    total: number;
  }[];
  daily_deals: { day: string; count: number }[];
  activity: { verb: string; count: number }[];
}

interface RawPayload {
  contacts: number | string | null;
  companies: number | string | null;
  deals: number | string | null;
  tasks_open: number | string | null;
  pipeline_value: number | string | null;
  won_value: number | string | null;
  stages:
    | {
        stage_id: number;
        name: string;
        position: number;
        is_won: boolean;
        is_lost: boolean;
        count: number | string | null;
        total: number | string | null;
      }[]
    | null;
  daily_deals: { day: string; count: number | string | null }[] | null;
  activity: { verb: string; count: number | string | null }[] | null;
}

const SUMMARY_TTL_MS = 30_000;

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
}

async function loadSummary(uid: number, isAdmin: boolean): Promise<SummaryPayload> {
  const q = sql();

  // Admin sees the full database; non-admin sees only their own rows.
  // The `uid` placeholder is ignored by the admin branch but postgres.js
  // binds it cleanly either way, so both branches reuse the same shape.
  const rows = (isAdmin
    ? await q`
        select json_build_object(
          'contacts',       (select count(*) from contacts where deleted_at is null),
          'companies',      (select count(*) from companies where deleted_at is null),
          'deals',          (select count(*) from deals where deleted_at is null),
          'tasks_open',     (select count(*) from tasks where deleted_at is null and status <> 'done'),
          'pipeline_value', (select coalesce(sum(amount),0) from deals where deleted_at is null and status = 'open'),
          'won_value',      (select coalesce(sum(amount),0) from deals where deleted_at is null and status = 'won'),
          'stages', (
            select coalesce(json_agg(row_to_json(s) order by s.position), '[]'::json)
            from (
              select s.id as stage_id, s.name, s.position, s.is_won, s.is_lost,
                     count(d.id) as count,
                     coalesce(sum(d.amount),0) as total
              from pipeline_stages s
              left join deals d on d.stage_id = s.id and d.deleted_at is null
              group by s.id, s.name, s.position, s.is_won, s.is_lost
            ) s
          ),
          'daily_deals', (
            select coalesce(json_agg(row_to_json(d) order by d.day), '[]'::json)
            from (
              select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
                     count(*) as count
              from deals
              where deleted_at is null and created_at >= now() - interval '30 days'
              group by 1
            ) d
          ),
          'activity', (
            select coalesce(json_agg(row_to_json(a) order by a.count desc), '[]'::json)
            from (
              select verb, count(*) as count
              from activity_log
              where created_at >= now() - interval '30 days'
              group by verb
              order by count(*) desc
              limit 10
            ) a
          )
        ) as payload
      `
    : await q`
        select json_build_object(
          'contacts',       (select count(*) from contacts  where deleted_at is null and owner_id = ${uid}),
          'companies',      (select count(*) from companies where deleted_at is null and owner_id = ${uid}),
          'deals',          (select count(*) from deals     where deleted_at is null and owner_id = ${uid}),
          'tasks_open',     (select count(*) from tasks     where deleted_at is null and status <> 'done' and owner_id = ${uid}),
          'pipeline_value', (select coalesce(sum(amount),0) from deals where deleted_at is null and status = 'open' and owner_id = ${uid}),
          'won_value',      (select coalesce(sum(amount),0) from deals where deleted_at is null and status = 'won'  and owner_id = ${uid}),
          'stages', (
            select coalesce(json_agg(row_to_json(s) order by s.position), '[]'::json)
            from (
              select s.id as stage_id, s.name, s.position, s.is_won, s.is_lost,
                     count(d.id) as count,
                     coalesce(sum(d.amount),0) as total
              from pipelines p
              join pipeline_stages s on s.pipeline_id = p.id
              left join deals d on d.stage_id = s.id
                                and d.deleted_at is null
                                and d.owner_id = ${uid}
              where p.owner_id = ${uid} and p.deleted_at is null
              group by s.id, s.name, s.position, s.is_won, s.is_lost
            ) s
          ),
          'daily_deals', (
            select coalesce(json_agg(row_to_json(d) order by d.day), '[]'::json)
            from (
              select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
                     count(*) as count
              from deals
              where deleted_at is null
                and created_at >= now() - interval '30 days'
                and owner_id = ${uid}
              group by 1
            ) d
          ),
          'activity', (
            select coalesce(json_agg(row_to_json(a) order by a.count desc), '[]'::json)
            from (
              select verb, count(*) as count
              from activity_log
              where created_at >= now() - interval '30 days' and owner_id = ${uid}
              group by verb
              order by count(*) desc
              limit 10
            ) a
          )
        ) as payload
      `) as Array<{ payload: RawPayload }>;

  const r = rows[0]?.payload ?? ({} as RawPayload);

  return {
    counts: {
      contacts: num(r.contacts),
      companies: num(r.companies),
      deals: num(r.deals),
      tasks_open: num(r.tasks_open),
    },
    pipeline_value: num(r.pipeline_value),
    won_value: num(r.won_value),
    stages: (r.stages ?? []).map((s) => ({
      stage_id: s.stage_id,
      name: s.name,
      position: s.position,
      is_won: s.is_won,
      is_lost: s.is_lost,
      count: num(s.count),
      total: num(s.total),
    })),
    daily_deals: (r.daily_deals ?? []).map((d) => ({ day: d.day, count: num(d.count) })),
    activity: (r.activity ?? []).map((a) => ({ verb: a.verb, count: num(a.count) })),
  };
}

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const isAdmin = user.role === "admin";
    const cacheKey = `summary:${isAdmin ? "admin" : `u${user.id}`}`;
    const payload = await getOrSet(cacheKey, SUMMARY_TTL_MS, () =>
      loadSummary(user.id, isAdmin),
    );
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, max-age=15, stale-while-revalidate=45",
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
