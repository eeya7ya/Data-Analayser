import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import {
  canSignOffQuotation,
  logLeadEvent,
  sendLeadMessage,
} from "@/lib/leads";
import { sendPushToUsers } from "@/lib/push";

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
    const isAdmin = canReadAll(user);
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
    if (
      lead.status !== "assigned" &&
      lead.status !== "in_progress" &&
      lead.status !== "quotation_review"
    ) {
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

    // V1.3c — presales manager signs off BEFORE the quotation reaches
    // sales. A plain presales member's submit parks the lead in
    // `quotation_review` and pings the managers; a manager (or admin)
    // releases it straight to sales.
    const isSignOffAuthority = await canSignOffQuotation(user);

    if (!isSignOffAuthority) {
      // Member path → awaiting manager sign-off.
      const subject =
        body.subject?.trim() ||
        `[Lead ${lead.ref}] Quotation ${quotation.ref} ready for your sign-off`;
      const bodyText =
        body.body?.trim() ||
        `${user.display_name || user.username} prepared a quotation for this lead.\n\n` +
          `Lead: ${lead.title}\n` +
          `Quotation: ${quotation.ref} — ${quotation.project_name}\n\n` +
          `Review it, then release it to sales (or send it back for changes).`;

      const managers = (await q`
        select distinct user_id from user_module_roles
        where module = 'crm' and role = 'presales_manager' and revoked_at is null
      `) as Array<{ user_id: number }>;
      const admins = (await q`
        select id as user_id from users where role = 'admin'
      `) as Array<{ user_id: number }>;
      const recipients = new Set<number>();
      for (const m of managers) recipients.add(m.user_id);
      for (const a of admins) recipients.add(a.user_id);

      await q`
        update leads
        set quotation_id = ${quotationId},
            quotation_email_subject = ${subject},
            quotation_email_body = ${bodyText},
            status = 'quotation_review',
            updated_at = now()
        where id = ${leadId}
      `;
      await logLeadEvent(
        leadId,
        user.id,
        "quotation_review",
        `Quotation ${quotation.ref} submitted for presales-manager sign-off`,
        { quotation_id: quotationId },
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
      void sendPushToUsers([...recipients], {
        title: `Quotation ${quotation.ref} needs sign-off`,
        body: `${lead.title} — review and release to sales.`,
        url: `/leads/${leadId}`,
        tag: `lead-review-${leadId}`,
      });
      return NextResponse.json({ ok: true, status: "quotation_review" });
    }

    // Manager / admin path → release straight to sales.
    const subject =
      body.subject?.trim() ||
      `[Lead ${lead.ref}] Quotation ${quotation.ref} ready for sales decision`;
    const bodyText =
      body.body?.trim() ||
      `${user.display_name || user.username} released a quotation for this lead.\n\n` +
        `Lead: ${lead.title}\n` +
        `Quotation: ${quotation.ref} — ${quotation.project_name}\n\n` +
        `Open the lead and hold it, mark it sold, or push it to execution.`;

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

    await q`
      update leads
      set quotation_id = ${quotationId},
          quotation_sent_at = now(),
          quotation_email_subject = ${subject},
          quotation_email_body = ${bodyText},
          status = 'quotation_sent',
          updated_at = now()
      where id = ${leadId}
    `;

    await logLeadEvent(
      leadId,
      user.id,
      "quotation_sent",
      `Quotation ${quotation.ref} released to sales`,
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
    void sendPushToUsers(recipients, {
      title: `Quotation ${quotation.ref} ready for you`,
      body: `${lead.title} — hold, mark sold, or push to execution.`,
      url: `/leads/${leadId}`,
      tag: `lead-quotation-${leadId}`,
    });

    return NextResponse.json({ ok: true, status: "quotation_sent" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
