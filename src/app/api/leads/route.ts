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
             l.company_id, l.folder_id, l.contact_id, l.quotation_id,
             l.outcome, l.outcome_at, l.created_at, l.updated_at
      from leads l
      left join users cu on cu.id = l.created_by
      left join users au on au.id = l.assigned_to_id
      where l.deleted_at is null
        and (${statusFilter}::text is null or l.status = ${statusFilter})
        and (
          ${vis.full}::boolean
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
    const ownerScope = user.role === "admin" ? null : user.id;
    let folderId: number | null = null;
    let companyId: number | null = null;
    let contactId: number | null = null;
    if (Number.isInteger(body.folder_id) && Number(body.folder_id) > 0) {
      const fr = (await q`
        select id, company_id from client_folders
        where id = ${Number(body.folder_id)} and deleted_at is null
          and (${ownerScope}::int is null or owner_id = ${ownerScope})
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
          and (${ownerScope}::int is null or owner_id = ${ownerScope})
        limit 1
      `) as Array<{ id: number }>;
      if (cr.length > 0) companyId = cr[0].id;
    }
    if (Number.isInteger(body.contact_id) && Number(body.contact_id) > 0) {
      const ctr = (await q`
        select id from contacts
        where id = ${Number(body.contact_id)} and deleted_at is null
          and (${ownerScope}::int is null or owner_id = ${ownerScope})
        limit 1
      `) as Array<{ id: number }>;
      if (ctr.length > 0) contactId = ctr[0].id;
    }

    const inserted = (await q`
      insert into leads
        (ref, title, description, source, priority, status,
         created_by, requested_timeline_at, company_id, folder_id, contact_id)
      values
        (${ref}, ${title}, ${description}, ${source}, ${priority}, 'new',
         ${user.id}, ${requestedTimelineAt}, ${companyId}, ${folderId}, ${contactId})
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

