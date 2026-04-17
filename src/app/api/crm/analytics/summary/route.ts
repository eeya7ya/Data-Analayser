import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";
import { getOrSet } from "@/lib/cache";

export const runtime = "nodejs";

/**
 * Dashboard summary — this endpoint fans out to 9 aggregations in parallel.
 * Previously each request rebuilt the whole picture from scratch, which is
 * why the CRM dashboard was timing out under load: 9 × Supabase round-trips
 * per page view, with the pooled connection serialising some of them.
 *
 * Two changes to keep this fast at 1000× growth:
 *
 *   1. Result is cached per (userId, role) for 30 s via the in-process
 *      `getOrSet` helper. Concurrent callers coalesce onto a single loader
 *      so a navigation refresh never fires 9 queries twice.
 *
 *   2. The stage aggregation is now scoped to the user's own pipelines (via
 *      `join pipelines`), so a non-admin user never pays to aggregate
 *      another tenant's stages. Admins still see the global view.
 *
 * If nothing has changed in the CRM in the last 30 s the dashboard paints
 * instantly from the cache — no database contact at all.
 */

interface CountRow {
  n: string;
}
interface SumRow {
  total: string | null;
}
interface DailyRow {
  day: string;
  n: string;
}
interface StageRow {
  stage_id: number;
  name: string;
  position: number;
  n: string;
  total: string | null;
  is_won: boolean;
  is_lost: boolean;
}
interface VerbRow {
  verb: string;
  n: string;
}

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

const SUMMARY_TTL_MS = 30_000;

async function loadSummary(uid: number, isAdmin: boolean): Promise<SummaryPayload> {
  const q = sql();

  const [
    contactsTotal,
    companiesTotal,
    dealsTotal,
    tasksOpen,
    pipelineValue,
    wonValue,
    stages,
    dailyDeals,
    activity,
  ] = await Promise.all([
    (isAdmin
      ? q`select count(*)::text as n from contacts where deleted_at is null`
      : q`select count(*)::text as n from contacts where deleted_at is null and owner_id = ${uid}`) as Promise<CountRow[]>,
    (isAdmin
      ? q`select count(*)::text as n from companies where deleted_at is null`
      : q`select count(*)::text as n from companies where deleted_at is null and owner_id = ${uid}`) as Promise<CountRow[]>,
    (isAdmin
      ? q`select count(*)::text as n from deals where deleted_at is null`
      : q`select count(*)::text as n from deals where deleted_at is null and owner_id = ${uid}`) as Promise<CountRow[]>,
    (isAdmin
      ? q`select count(*)::text as n from tasks where deleted_at is null and status <> 'done'`
      : q`select count(*)::text as n from tasks where deleted_at is null and status <> 'done' and owner_id = ${uid}`) as Promise<CountRow[]>,
    (isAdmin
      ? q`select coalesce(sum(amount),0)::text as total from deals where deleted_at is null and status = 'open'`
      : q`select coalesce(sum(amount),0)::text as total from deals where deleted_at is null and status = 'open' and owner_id = ${uid}`) as Promise<SumRow[]>,
    (isAdmin
      ? q`select coalesce(sum(amount),0)::text as total from deals where deleted_at is null and status = 'won'`
      : q`select coalesce(sum(amount),0)::text as total from deals where deleted_at is null and status = 'won' and owner_id = ${uid}`) as Promise<SumRow[]>,
    // Stage aggregation — non-admin path is now scoped to the user's own
    // pipelines so the LEFT JOIN doesn't fan out across every tenant's
    // stages. The `deals_owner_status_idx` composite index covers the deal
    // side; pipeline_stages(pipeline_id, position) covers the stage side.
    (isAdmin
      ? q`
          select s.id as stage_id, s.name, s.position, s.is_won, s.is_lost,
                 count(d.id)::text as n,
                 coalesce(sum(d.amount),0)::text as total
          from pipeline_stages s
          left join deals d on d.stage_id = s.id and d.deleted_at is null
          group by s.id, s.name, s.position, s.is_won, s.is_lost
          order by s.position asc
        `
      : q`
          select s.id as stage_id, s.name, s.position, s.is_won, s.is_lost,
                 count(d.id)::text as n,
                 coalesce(sum(d.amount),0)::text as total
          from pipelines p
          join pipeline_stages s on s.pipeline_id = p.id
          left join deals d on d.stage_id = s.id
                            and d.deleted_at is null
                            and d.owner_id = ${uid}
          where p.owner_id = ${uid} and p.deleted_at is null
          group by s.id, s.name, s.position, s.is_won, s.is_lost
          order by s.position asc
        `) as Promise<StageRow[]>,
    (isAdmin
      ? q`
          select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
                 count(*)::text as n
          from deals
          where deleted_at is null and created_at >= now() - interval '30 days'
          group by 1 order by 1 asc
        `
      : q`
          select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
                 count(*)::text as n
          from deals
          where deleted_at is null and created_at >= now() - interval '30 days'
            and owner_id = ${uid}
          group by 1 order by 1 asc
        `) as Promise<DailyRow[]>,
    (isAdmin
      ? q`
          select verb, count(*)::text as n
          from activity_log
          where created_at >= now() - interval '30 days'
          group by verb order by n desc limit 10
        `
      : q`
          select verb, count(*)::text as n
          from activity_log
          where created_at >= now() - interval '30 days' and owner_id = ${uid}
          group by verb order by n desc limit 10
        `) as Promise<VerbRow[]>,
  ]);

  return {
    counts: {
      contacts: Number(contactsTotal[0]?.n ?? 0),
      companies: Number(companiesTotal[0]?.n ?? 0),
      deals: Number(dealsTotal[0]?.n ?? 0),
      tasks_open: Number(tasksOpen[0]?.n ?? 0),
    },
    pipeline_value: Number(pipelineValue[0]?.total ?? 0),
    won_value: Number(wonValue[0]?.total ?? 0),
    stages: stages.map((r) => ({
      stage_id: r.stage_id,
      name: r.name,
      position: r.position,
      is_won: r.is_won,
      is_lost: r.is_lost,
      count: Number(r.n),
      total: Number(r.total ?? 0),
    })),
    daily_deals: dailyDeals.map((r) => ({ day: r.day, count: Number(r.n) })),
    activity: activity.map((r) => ({ verb: r.verb, count: Number(r.n) })),
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
        // Browser/CDN can reuse the payload for up to 15 s and revalidate
        // in the background for 45 s. Private because it's per-user.
        "Cache-Control": "private, max-age=15, stale-while-revalidate=45",
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
