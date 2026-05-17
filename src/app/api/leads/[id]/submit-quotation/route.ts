import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canTransition, logLeadEvent, sendLeadMessage } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/submit-quotation
 *
 * Presales user pushes the prepared quotation back to sales in
 * "email format". The body carries the quotation_id (already created
 * in the Designer), an optional subject and body for the inbox
 * message, and an optional list of sales users to address. If no
 * recipient list is provided, every active sales / sales_manager user
 * gets a copy.
 *
 * Status moves to `quotation_sent`. Only the assigned presales user,
 * the lead creator, an admin, or a presales_manager can submit.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { id } = await ctx.params;
    const leadId = Number(id);
    if (!Number.isFinite(leadId) || leadId <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    const body = (await req.json()) as {
      quotation_id?: number;
      subject?: string;
      body?: string;
      recipient_ids?: number[];
    };
    const quotationId = Number(body.quotation_id);
    if (!Number.isInteger(quotationId) || quotationId <= 0) {
      return NextResponse.json(
        { error: "quotation_id is required" },
        { status: 400 },
      );
    }

    const q = sql();
    const leadRows = (await q`
      select id, ref, title, status, assigned_to_id, created_by
      from leads where id = ${leadId} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      title: string;
      status: string;
      assigned_to_id: number | null;
      created_by: number | null;
    }>;
    if (leadRows.length === 0) {
      return NextResponse.json({ error: "lead not found" }, { status: 404 });
    }
    const lead = leadRows[0];

    const isOwner = lead.assigned_to_id === user.id || lead.created_by === user.id;
    const isAdmin = user.role === "admin";
    if (!isAdmin && !isOwner) {
      // Also allow presales managers to submit on behalf of their team.
      const isManager = (
        (await q`
          select 1 from user_module_roles
          where user_id = ${user.id} and module = 'crm'
            and role = 'presales_manager' and revoked_at is null
          limit 1
        `) as Array<{ "?column?": number }>
      ).length > 0;
      if (!isManager) {
        return NextResponse.json(
          { error: "only the assigned presales user can submit" },
          { status: 403 },
        );
      }
    }

    // The lead has to be at a stage where submission makes sense.
    // We allow both `assigned` and `in_progress` to flow into
    // `quotation_sent` — the in-between stages are an aid to the
    // presales user, not a wall.
    if (lead.status !== "assigned" && lead.status !== "in_progress") {
      return NextResponse.json(
        {
          error: `cannot submit quotation from status "${lead.status}"`,
        },
        { status: 409 },
      );
    }
    // We don't enforce the canTransition map for the assigned →
    // quotation_sent jump, because in_progress is an implicit substage
    // that the UI may skip. Both source states converge on
    // quotation_sent so the next stage is unambiguous.

    // Validate the quotation exists.
    const quotationRows = (await q`
      select id, ref, project_name from quotations where id = ${quotationId} and deleted_at is null
      limit 1
    `) as Array<{ id: number; ref: string; project_name: string }>;
    if (quotationRows.length === 0) {
      return NextResponse.json(
        { error: "quotation not found" },
        { status: 404 },
      );
    }
    const quotation = quotationRows[0];

    const subject =
      body.subject?.trim() ||
      `[Lead ${lead.ref}] Quotation ${quotation.ref} ready for sales decision`;
    const bodyText =
      body.body?.trim() ||
      `${user.display_name || user.username} prepared a quotation for this lead.\n\n` +
        `Lead: ${lead.title}\n` +
        `Quotation: ${quotation.ref} — ${quotation.project_name}\n\n` +
        `Open the lead and mark it Won or Lost.`;

    // Build the recipient list. Explicit recipient_ids wins; otherwise
    // we fan out to every active sales / sales_manager.
    let recipients: number[] = [];
    if (Array.isArray(body.recipient_ids) && body.recipient_ids.length > 0) {
      recipients = body.recipient_ids
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n > 0);
    } else {
      const rows = (await q`
        select distinct user_id from user_module_roles
        where module = 'crm' and role in ('sales','sales_manager')
          and revoked_at is null
      `) as Array<{ user_id: number }>;
      recipients = rows.map((r) => r.user_id);
      // Always include the lead creator if they're not already on the
      // list, so a sales user who opened the lead themselves still
      // sees the submission land in their inbox.
      if (lead.created_by && !recipients.includes(lead.created_by)) {
        recipients.push(lead.created_by);
      }
    }

    if (recipients.length === 0) {
      return NextResponse.json(
        { error: "no sales user found to send the quotation to" },
        { status: 409 },
      );
    }

    const newStatus = "quotation_sent";
    if (!canTransition("in_progress", newStatus) && !canTransition("assigned", "in_progress")) {
      // sanity guard — keep the transition map honest.
      return NextResponse.json({ error: "transition not allowed" }, { status: 409 });
    }

    await q`
      update leads
      set quotation_id = ${quotationId},
          quotation_sent_at = now(),
          quotation_email_subject = ${subject},
          quotation_email_body = ${bodyText},
          status = ${newStatus},
          updated_at = now()
      where id = ${leadId}
    `;

    await logLeadEvent(
      leadId,
      user.id,
      "quotation_sent",
      `Quotation ${quotation.ref} sent to sales`,
      { quotation_id: quotationId, recipients },
    );

    for (const rid of recipients) {
      await sendLeadMessage({
        leadId,
        senderId: user.id,
        recipientId: rid,
        kind: "quotation_sent_to_sales",
        subject,
        body: bodyText,
      });
    }

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
