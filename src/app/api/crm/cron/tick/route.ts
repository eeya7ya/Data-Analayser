import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";

export const runtime = "nodejs";

interface WorkflowRow {
  id: number;
  owner_id: number | null;
  name: string;
  trigger_kind: string;
  trigger_json: Record<string, unknown>;
  actions_json: Array<Record<string, unknown>>;
  enabled: boolean;
  last_run_at: string | null;
}

interface TaskRow {
  id: number;
  owner_id: number | null;
  assignee_id: number | null;
  title: string;
  due_at: string;
  priority: string;
  status: string;
}

interface QuotationRow {
  id: number;
  owner_id: number | null;
  ref: string | null;
  expiry_at: string | null;
  status: string | null;
}

/**
 * Vercel Cron tick. Runs scheduled workflows + emits in-app reminders for
 * due tasks and quotations approaching expiry. Vercel Cron is first-party
 * (not a third-party API), so this stays inside the "no external APIs"
 * guarantee. Authenticated by an out-of-band CRON_SECRET so manual GETs
 * cannot trigger it.
 */
async function authCron(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev — allow unauthenticated
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!(await authCron(req))) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  await ensureSchema();
  const settings = await getAppSettings();
  if (!settings.crmModuleEnabled) {
    return NextResponse.json({ ok: true, skipped: "crm_disabled" });
  }
  const q = sql();
  const summary: { workflows: number; reminders: number; quotation_alerts: number } = {
    workflows: 0,
    reminders: 0,
    quotation_alerts: 0,
  };

  // 1) Tasks due within the next 24 h get a one-shot reminder per task.
  //    Idempotency: we tag the notification with link='/crm/tasks#<id>:due'
  //    and skip if already present.
  const dueTasks = (await q`
    select id, owner_id, assignee_id, title, due_at, priority, status
    from tasks
    where deleted_at is null
      and status <> 'done'
      and due_at is not null
      and due_at <= now() + interval '24 hours'
      and due_at >  now() - interval '7 days'
  `) as TaskRow[];
  for (const t of dueTasks) {
    const target = t.assignee_id ?? t.owner_id;
    if (!target) continue;
    const link = `/crm/tasks#${t.id}:due`;
    const already = (await q`
      select 1 from notifications where user_id = ${target} and link = ${link} limit 1
    `) as Array<{ "?column?": number }>;
    if (already.length > 0) continue;
    await q`
      insert into notifications (user_id, kind, title, body, link)
      values (
        ${target},
        ${"task_due"},
        ${"Task due soon: " + t.title},
        ${"Due " + new Date(t.due_at).toLocaleString()},
        ${link}
      )
    `;
    summary.reminders += 1;
  }

  // 2) Quotations expiring in the next 7 days get a heads-up to the owner.
  //    Same one-shot tag pattern. The expiry_at column is optional in this
  //    schema; the query simply returns no rows if it's never set.
  const expiring = (await q`
    select id, owner_id, ref, expiry_at, status
    from quotations
    where expiry_at is not null
      and expiry_at <= now() + interval '7 days'
      and expiry_at >  now()
  `) as QuotationRow[];
  for (const Q of expiring) {
    if (!Q.owner_id) continue;
    const link = `/quotation#${Q.id}:expiry`;
    const already = (await q`
      select 1 from notifications where user_id = ${Q.owner_id} and link = ${link} limit 1
    `) as Array<{ "?column?": number }>;
    if (already.length > 0) continue;
    await q`
      insert into notifications (user_id, kind, title, body, link)
      values (
        ${Q.owner_id},
        ${"quotation_expiring"},
        ${"Quotation expiring: " + (Q.ref ?? "#" + Q.id)},
        ${"Expires " + new Date(Q.expiry_at as string).toLocaleString()},
        ${link}
      )
    `;
    summary.quotation_alerts += 1;
  }

  // 3) Run any 'schedule' workflows whose interval has elapsed. trigger_json
  //    accepts {minutes: <n>} for cadence; missing → daily default.
  const wfs = (await q`
    select id, owner_id, name, trigger_kind, trigger_json, actions_json, enabled, last_run_at
    from workflows
    where deleted_at is null and enabled = true and trigger_kind = 'schedule'
  `) as WorkflowRow[];
  for (const wf of wfs) {
    const minutes = Number((wf.trigger_json as { minutes?: number })?.minutes ?? 1440);
    if (wf.last_run_at) {
      const elapsed = Date.now() - new Date(wf.last_run_at).getTime();
      if (elapsed < minutes * 60_000) continue;
    }
    try {
      // Actions are a small JSON DSL: {kind: 'notify', user_id, title, body}.
      // No code execution from JSON — only whitelisted action shapes.
      for (const action of wf.actions_json) {
        const kind = (action as { kind?: string }).kind;
        if (kind === "notify") {
          const a = action as {
            user_id?: number;
            title?: string;
            body?: string;
            link?: string;
          };
          const target = a.user_id ?? wf.owner_id;
          if (!target) continue;
          await q`
            insert into notifications (user_id, kind, title, body, link)
            values (
              ${target},
              ${"workflow"},
              ${a.title ?? wf.name},
              ${a.body ?? null},
              ${a.link ?? null}
            )
          `;
        }
      }
      await q`update workflows set last_run_at = now() where id = ${wf.id}`;
      await q`
        insert into workflow_runs (workflow_id, status, message)
        values (${wf.id}, ${"ok"}, ${"tick"})
      `;
      summary.workflows += 1;
    } catch (e) {
      await q`
        insert into workflow_runs (workflow_id, status, message)
        values (${wf.id}, ${"error"}, ${(e as Error).message.slice(0, 240)})
      `;
    }
  }

  return NextResponse.json({ ok: true, summary });
}
