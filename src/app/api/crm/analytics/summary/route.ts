import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";

export const runtime = "nodejs";

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

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const q = sql();
    const isAdmin = user.role === "admin";
    const uid = user.id;

    // Each query is duplicated by-role to match the explicit owner-isolation
    // pattern used across the rest of the CRM API surface — postgres.js
    // fragment composition works but the codebase's house style is the ternary.
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
            from pipeline_stages s
            left join deals d on d.stage_id = s.id
                              and d.deleted_at is null
                              and d.owner_id = ${uid}
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

    return NextResponse.json({
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
    });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
