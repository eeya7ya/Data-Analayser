import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  canCreateLead,
  generateLeadRef,
  getLeadVisibility,
  logLeadEvent,
  sendLeadMessage,
  LEAD_PRIORITIES,
  type LeadPriority,
} from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/leads        → role-filtered list of leads.
 *                          Optional ?status=new|assigned|... to filter.
 *                          Optional ?scope=mine|inbox|all
 *                          (default = role-inferred).
 *
 * POST /api/leads        → create a new lead. Allowed for any CRM user
 *                          (sales / sales_manager / presales /
 *                          presales_manager). The lead lands in `new`
 *                          status, owned by the caller, and an inbox
 *                          message is dispatched to every presales_manager
 *                          so they can triage and assign.
 */

interface LeadRow {
  id: number;
  ref: string;
  title: string;
  description: string | null;
  source: string | null;
  priority: string;
  status: string;
  created_by: number | null;
  created_by_username: string | null;
  requested_timeline_at: string | null;
  assigned_to_id: number | null;
  assigned_to_username: string | null;
  company_id: number | null;
  folder_id: number | null;
  contact_id: number | null;
  quotation_id: number | null;
  outcome: string | null;
  outcome_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();

    const vis = await getLeadVisibility(user);
    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status");
    const scope = searchParams.get("scope") ?? "auto";

    const q = sql();

    // Build the WHERE clause from the user's effective visibility. We do
    // this with two SQL paths instead of one because the `postgres` tagged-
    // template lib doesn't compose dynamic OR/AND clauses cleanly — keeping
    // the queries fully written-out is far easier to audit than threading
    // 14 conditional fragments through one template.
    //
    // Visibility rules:
    //   - admin / presales_manager / sales_manager : every lead
    //   - sales (non-manager)                      : leads that have
    //                                                reached the sales
    //                                                stage (status >=
    //                                                quotation_sent) OR
    //                                                leads they created
    //   - presales (non-manager)                   : leads assigned to
    //                                                them OR they created
    //   - projects user (no CRM role)              : leads currently in
    //                                                their execution
    //                                                queue
    //
    // `scope=mine` always narrows to leads the user is directly
    // responsible for; `scope=inbox` narrows to leads waiting on the
    // user's action right now.

    let rows: LeadRow[];

    if (vis.full && scope !== "mine" && scope !== "inbox") {
      rows = (await q`
        select l.id, l.ref, l.title, l.description, l.source, l.priority, l.status,
               l.created_by, cu.username as created_by_username,
               l.requested_timeline_at,
               l.assigned_to_id, au.username as assigned_to_username,
               l.company_id, l.folder_id, l.contact_id, l.quotation_id,
               l.outcome, l.outcome_at, l.created_at, l.updated_at
        from leads l
        left join users cu on cu.id = l.created_by
        left join users au on au.id = l.assigned_to_id
        where l.deleted_at is null
          and (${statusFilter}::text is null or l.status = ${statusFilter})
        order by l.created_at desc
        limit 500
      `) as LeadRow[];
    } else if (scope === "inbox") {
      // "Waiting on me" — different per role.
      rows = (await q`
        select l.id, l.ref, l.title, l.description, l.source, l.priority, l.status,
               l.created_by, cu.username as created_by_username,
               l.requested_timeline_at,
               l.assigned_to_id, au.username as assigned_to_username,
               l.company_id, l.folder_id, l.contact_id, l.quotation_id,
               l.outcome, l.outcome_at, l.created_at, l.updated_at
        from leads l
        left join users cu on cu.id = l.created_by
        left join users au on au.id = l.assigned_to_id
        where l.deleted_at is null
          and (
            -- presales manager / admin: untriaged + waiting-on-execution-route
            (${vis.full}::boolean and l.status in ('new','boq_in_progress'))
            -- assigned presales user: their own active work
            or (${vis.ownerOnly}::boolean and l.assigned_to_id = ${vis.userId}
                and l.status in ('assigned','in_progress','won'))
            -- sales: quotation waiting for decision
            or (${vis.sales}::boolean and l.status = 'quotation_sent')
            -- projects: lead handed to me for execution
            or (${vis.execution}::boolean and l.execution_assignee_id = ${vis.userId}
                and l.status = 'sent_to_execution')
          )
        order by
          case l.priority
            when 'urgent' then 0
            when 'high'   then 1
            when 'normal' then 2
            else 3
          end,
          l.created_at desc
        limit 500
      `) as LeadRow[];
    } else {
      // Default "mine" — anything I created, am assigned to, or am
      // executing. Status filter still applies on top.
      rows = (await q`
        select l.id, l.ref, l.title, l.description, l.source, l.priority, l.status,
               l.created_by, cu.username as created_by_username,
               l.requested_timeline_at,
               l.assigned_to_id, au.username as assigned_to_username,
               l.company_id, l.folder_id, l.contact_id, l.quotation_id,
               l.outcome, l.outcome_at, l.created_at, l.updated_at
        from leads l
        left join users cu on cu.id = l.created_by
        left join users au on au.id = l.assigned_to_id
        where l.deleted_at is null
          and (${statusFilter}::text is null or l.status = ${statusFilter})
          and (
            l.created_by = ${vis.userId}
            or l.assigned_to_id = ${vis.userId}
            or l.execution_assignee_id = ${vis.userId}
            -- managers always see the full list when they hit "mine" with
            -- no scope hint, so they don't get an empty page after we
            -- default scope=auto for them
            or ${vis.full}::boolean
            -- sales role sees quotations in flight even on "mine"
            or (${vis.sales}::boolean and l.status in ('quotation_sent','won','lost','completed'))
          )
        order by l.created_at desc
        limit 500
      `) as LeadRow[];
    }

    return NextResponse.json({ leads: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    if (!(await canCreateLead(user))) {
      return NextResponse.json(
        { error: "needs a CRM role to open a lead" },
        { status: 403 },
      );
    }

    const body = (await req.json()) as {
      title?: string;
      description?: string;
      source?: string;
      priority?: LeadPriority;
      requested_timeline_at?: string | null;
    };

    const title = String(body.title ?? "").trim();
    if (!title) {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 },
      );
    }
    const priority: LeadPriority = LEAD_PRIORITIES.includes(
      (body.priority ?? "normal") as LeadPriority,
    )
      ? ((body.priority ?? "normal") as LeadPriority)
      : "normal";

    const description = body.description?.trim() ?? null;
    const source = body.source?.trim() ?? null;
    const requestedTimelineAt = body.requested_timeline_at || null;

    const ref = await generateLeadRef();

    const q = sql();
    const inserted = (await q`
      insert into leads
        (ref, title, description, source, priority, status,
         created_by, requested_timeline_at)
      values
        (${ref}, ${title}, ${description}, ${source}, ${priority}, 'new',
         ${user.id}, ${requestedTimelineAt})
      returning id, ref
    `) as Array<{ id: number; ref: string }>;
    const leadId = inserted[0].id;

    await logLeadEvent(leadId, user.id, "created", `Lead opened — ${title}`, {
      ref,
      priority,
      requested_timeline_at: requestedTimelineAt,
    });

    // Notify every presales_manager so they see the new entry in their
    // triage queue. We do this synchronously because there are at most a
    // handful of managers per org — the fan-out cost is trivial. If a
    // lead is opened BY a presales_manager they still get the email so
    // the audit trail is consistent (and a manager may delegate triage
    // to another manager).
    const managers = (await q`
      select user_id
      from user_module_roles
      where module = 'crm' and role = 'presales_manager' and revoked_at is null
    `) as Array<{ user_id: number }>;

    // Also include legacy admin users so leads are never stuck without a
    // triager in a fresh deployment.
    const admins = (await q`
      select id as user_id from users where role = 'admin'
    `) as Array<{ user_id: number }>;

    const recipientIds = new Set<number>();
    for (const m of managers) recipientIds.add(m.user_id);
    for (const a of admins) recipientIds.add(a.user_id);

    const subject = `[Lead ${ref}] ${title}`;
    const timelineLine = requestedTimelineAt
      ? `Sales requested presales response by: ${requestedTimelineAt}\n\n`
      : "";
    const bodyText =
      `${user.display_name || user.username} just opened a new lead.\n\n` +
      `Title: ${title}\n` +
      `Priority: ${priority}\n` +
      (description ? `Description:\n${description}\n\n` : "\n") +
      timelineLine +
      `Open the lead to triage and assign a presales engineer.`;

    for (const rid of recipientIds) {
      await sendLeadMessage({
        leadId,
        senderId: user.id,
        recipientId: rid,
        kind: "lead_assigned",
        subject,
        body: bodyText,
      });
    }

    return NextResponse.json({ ok: true, id: leadId, ref });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

