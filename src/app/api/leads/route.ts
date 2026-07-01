import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getTenantUserIds } from "@/lib/scope";
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
 *                          Optional ?status=new|in_progress to filter.
 *
 * POST /api/leads        → open a new lead (the RFQ). Allowed for sales
 *                          roles / admin. The lead lands in `new` status
 *                          (unclaimed) in the shared queue, owned by the
 *                          caller, and a message is dispatched to the whole
 *                          presales team so any of them can claim it.
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
  project_id: number | null;
  quotation_id: number | null;
  outcome: string | null;
  outcome_at: string | null;
  completed_at: string | null;
  quotation_sent_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  /** Latest quotation built under the lead's project, if any. */
  quote_id: number | null;
  quote_ref: string | null;
  quote_sent_to_sales_at: string | null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();

    const vis = await getLeadVisibility(user);
    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status");
    // Per-project filter powers the "Request for Quotation" status chip on
    // the project page (one open RFQ per project).
    const projectIdParam = searchParams.get("project_id");
    const projectId =
      projectIdParam && Number.isFinite(Number(projectIdParam))
        ? Number(projectIdParam)
        : null;
    // 1.4D — once a quotation is sent to sales the lead is `completed_at`
    // stamped and drops out of the presales queue. Default view hides them;
    // `?include=done` brings the finished ones back (e.g. for an archive
    // tab). The per-project lookup always includes them so the RFQ chip can
    // still find the (now-completed) request.
    const includeDone =
      searchParams.get("include") === "done" || projectId !== null;
    // `?view=junk` lists the junked (soft-deleted) leads so presales can
    // restore or permanently delete them. Anything else is the live queue.
    const junkView = searchParams.get("view") === "junk";

    const q = sql();

    // Visibility:
    //   - admin / any presales role : every lead (the shared queue)
    //   - everyone else (sales)     : leads they opened
    // Optional ?status filter (new | in_progress) applies on top.
    const rows = (await q`
      select l.id, l.ref, l.title, l.description, l.source, l.priority, l.status,
             l.created_by, cu.username as created_by_username,
             l.requested_timeline_at,
             l.assigned_to_id, au.username as assigned_to_username,
             l.company_id, l.folder_id, l.contact_id, l.project_id, l.quotation_id,
             l.outcome, l.outcome_at, l.completed_at, l.quotation_sent_at,
             l.deleted_at, l.created_at, l.updated_at,
             ql.id  as quote_id,
             ql.ref as quote_ref,
             ql.sent_to_sales_at as quote_sent_to_sales_at
      from leads l
      left join users cu on cu.id = l.created_by
      left join users au on au.id = l.assigned_to_id
      left join quotations ql on ql.id = (
        select qq.id
        from quotations qq
        where qq.project_id = l.project_id and qq.deleted_at is null
        order by qq.created_at desc
        limit 1
      )
      where (
          (${junkView}::boolean = true and l.deleted_at is not null)
          or (${junkView}::boolean = false and l.deleted_at is null)
        )
        and (${statusFilter}::text is null or l.status = ${statusFilter})
        and (
          ${projectId}::int is null
          or l.project_id = ${projectId}
          or l.sales_project_id = ${projectId}
        )
        and (${junkView}::boolean = true or ${includeDone}::boolean = true or l.completed_at is null)
        and (
          (${vis.full}::boolean and l.created_by = any(${vis.tenantUserIds}::int[]))
          or l.created_by = ${vis.userId}
          or l.assigned_to_id = ${vis.userId}
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
      // V1.3D — Request for Quotation context. When sales opens an RFQ from
      // a client / project, the company + client folder (+ optional contact)
      // are smart-assigned so presales picks up the lead already linked to
      // the right account. Validated below against rows the caller can see.
      company_id?: number | null;
      folder_id?: number | null;
      contact_id?: number | null;
      // 1.4B — RFQ is opened per project. When present, the project is the
      // authoritative link: its folder + company override the loose ids
      // above, and only one open RFQ is allowed per project.
      project_id?: number | null;
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

    // Smart-assign context — only persist IDs that actually resolve to a
    // live row (and, for non-admins, one they own) so a stray id from the
    // query string can't attach a lead to someone else's account.
    const ownerIds =
      user.role === "admin" ? await getTenantUserIds(user.id) : [user.id];
    let folderId: number | null = null;
    let companyId: number | null = null;
    let contactId: number | null = null;
    if (Number.isInteger(body.folder_id) && Number(body.folder_id) > 0) {
      const fr = (await q`
        select id, company_id from client_folders
        where id = ${Number(body.folder_id)} and deleted_at is null
          and owner_id = any(${ownerIds}::int[])
        limit 1
      `) as Array<{ id: number; company_id: number | null }>;
      if (fr.length > 0) {
        folderId = fr[0].id;
        companyId = fr[0].company_id;
      }
    }
    if (
      companyId === null &&
      Number.isInteger(body.company_id) &&
      Number(body.company_id) > 0
    ) {
      const cr = (await q`
        select id from companies
        where id = ${Number(body.company_id)} and deleted_at is null
          and owner_id = any(${ownerIds}::int[])
        limit 1
      `) as Array<{ id: number }>;
      if (cr.length > 0) companyId = cr[0].id;
    }
    if (Number.isInteger(body.contact_id) && Number(body.contact_id) > 0) {
      const ctr = (await q`
        select id from contacts
        where id = ${Number(body.contact_id)} and deleted_at is null
          and owner_id = any(${ownerIds}::int[])
        limit 1
      `) as Array<{ id: number }>;
      if (ctr.length > 0) contactId = ctr[0].id;
    }

    // Project link (the RFQ's authoritative anchor). Resolve it against a
    // live project the caller can reach — their own, or one in a folder
    // they own — and inherit the project's folder + company so the lead is
    // always tied to the right account. Admins may attach to any project.
    let projectId: number | null = null;
    if (Number.isInteger(body.project_id) && Number(body.project_id) > 0) {
      const pr = (await q`
        select p.id, p.folder_id, p.owner_id as project_owner_id,
               cf.company_id, cf.owner_id as folder_owner_id
        from projects p
        join client_folders cf on cf.id = p.folder_id and cf.deleted_at is null
        where p.id = ${Number(body.project_id)} and p.deleted_at is null
        limit 1
      `) as Array<{
        id: number;
        folder_id: number;
        project_owner_id: number | null;
        company_id: number | null;
        folder_owner_id: number | null;
      }>;
      if (
        pr.length > 0 &&
        ((pr[0].project_owner_id != null &&
          ownerIds.includes(pr[0].project_owner_id)) ||
          (pr[0].folder_owner_id != null &&
            ownerIds.includes(pr[0].folder_owner_id)))
      ) {
        projectId = pr[0].id;
        folderId = pr[0].folder_id;
        companyId = pr[0].company_id;
      }
    }

    // One open RFQ per project. An existing lead for this project that is
    // still being worked (new / in_progress) blocks a duplicate; resolved
    // ones don't, so a fresh request is allowed once the prior is done.
    if (projectId !== null) {
      const open = (await q`
        select id, ref, status from leads
        where project_id = ${projectId}
          and deleted_at is null
          and status in ('new', 'in_progress')
        order by created_at desc
        limit 1
      `) as Array<{ id: number; ref: string; status: string }>;
      if (open.length > 0) {
        return NextResponse.json(
          {
            error: "This project already has an open quotation request.",
            existing: open[0],
          },
          { status: 409 },
        );
      }
    }

    const inserted = (await q`
      insert into leads
        (ref, title, description, source, priority, status,
         created_by, requested_timeline_at, company_id, folder_id, contact_id,
         project_id, sales_project_id)
      values
        (${ref}, ${title}, ${description}, ${source}, ${priority}, 'new',
         ${user.id}, ${requestedTimelineAt}, ${companyId}, ${folderId}, ${contactId},
         ${projectId}, ${projectId})
      returning id, ref
    `) as Array<{ id: number; ref: string }>;
    const leadId = inserted[0].id;

    await logLeadEvent(leadId, user.id, "created", `Lead opened — ${title}`, {
      ref,
      priority,
      requested_timeline_at: requestedTimelineAt,
    });

    // Notify the whole presales team so the lead surfaces in the shared
    // queue — any of them can claim it. There is no manager triage step.
    // The fan-out is synchronous because presales teams are small.
    const presales = (await q`
      select distinct user_id
      from user_module_roles
      where module = 'crm'
        and role in ('presales', 'presales_manager')
        and revoked_at is null
    `) as Array<{ user_id: number }>;

    // Also include legacy admin users so leads are never stuck without a
    // presales audience in a fresh deployment.
    const admins = (await q`
      select id as user_id from users where role = 'admin'
    `) as Array<{ user_id: number }>;

    const recipientIds = new Set<number>();
    for (const p of presales) recipientIds.add(p.user_id);
    for (const a of admins) recipientIds.add(a.user_id);
    // Don't ping the opener about their own lead.
    recipientIds.delete(user.id);

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
      `It's in the presales queue — open it and claim it to start working.`;

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

