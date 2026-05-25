import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canSignOffQuotation, logLeadEvent, sendLeadMessage } from "@/lib/leads";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/approve-quotation
 *
 * Presales-manager sign-off. From `quotation_review`:
 *   - { action: "release" } (default) → release to sales (quotation_sent),
 *     notifying every sales / sales_manager user.
 *   - { action: "reject", reason? }   → send back to the presales member
 *     for changes (in_progress).
 *
 * Only presales_manager / admin can sign off.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    if (!(await canSignOffQuotation(user))) {
      return NextResponse.json(
        { error: "only presales managers can sign off a quotation" },
        { status: 403 },
      );
    }
    const { id } = await ctx.params;
    const leadId = Number(id);
    if (!Number.isFinite(leadId) || leadId <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      reason?: string;
    };
    const action = body.action === "reject" ? "reject" : "release";

    const q = sql();
    const rows = (await q`
      select l.id, l.ref, l.title, l.status, l.created_by, l.assigned_to_id,
             l.quotation_id, qq.ref as quotation_ref
      from leads l
      left join quotations qq on qq.id = l.quotation_id
      where l.id = ${leadId} and l.deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      title: string;
      status: string;
      created_by: number | null;
      assigned_to_id: number | null;
      quotation_id: number | null;
      quotation_ref: string | null;
    }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "lead not found" }, { status: 404 });
    }
    const lead = rows[0];
    if (lead.status !== "quotation_review") {
      return NextResponse.json(
        { error: `lead is not awaiting sign-off (status "${lead.status}")` },
        { status: 409 },
      );
    }

    if (action === "reject") {
      const reason = (body.reason || "").trim();
      await q`
        update leads set status = 'in_progress', updated_at = now()
        where id = ${leadId}
      `;
      await logLeadEvent(
        leadId,
        user.id,
        "quotation_rework",
        reason
          ? `Sent back for changes: ${reason}`
          : "Sent back to presales for changes",
        {},
      );
      if (lead.assigned_to_id) {
        await sendLeadMessage({
          leadId,
          senderId: user.id,
          recipientId: lead.assigned_to_id,
          kind: "general",
          subject: `[Lead ${lead.ref}] Quotation sent back for changes`,
          body:
            (reason ? `${reason}\n\n` : "") +
            "Update the quotation and submit it again for sign-off.",
        });
        void sendPushToUsers([lead.assigned_to_id], {
          title: `Quotation sent back — ${lead.ref}`,
          body: reason || "Update the quotation and resubmit.",
          url: `/leads/${leadId}`,
          tag: `lead-rework-${leadId}`,
        });
      }
      return NextResponse.json({ ok: true, status: "in_progress" });
    }

    // Release to sales.
    const salesRows = (await q`
      select distinct user_id from user_module_roles
      where module = 'crm' and role in ('sales','sales_manager')
        and revoked_at is null
    `) as Array<{ user_id: number }>;
    const recipients = new Set<number>(salesRows.map((r) => r.user_id));
    if (lead.created_by) recipients.add(lead.created_by);
    if (recipients.size === 0) {
      return NextResponse.json(
        { error: "no sales user to release the quotation to" },
        { status: 409 },
      );
    }

    await q`
      update leads
      set status = 'quotation_sent', quotation_sent_at = now(), updated_at = now()
      where id = ${leadId}
    `;
    await logLeadEvent(
      leadId,
      user.id,
      "quotation_sent",
      `Quotation ${lead.quotation_ref ?? ""} signed off and released to sales`,
      { quotation_id: lead.quotation_id },
    );
    const subject = `[Lead ${lead.ref}] Quotation ${lead.quotation_ref ?? ""} ready for sales decision`;
    const bodyText =
      `${user.display_name || user.username} signed off the quotation for "${lead.title}".\n\n` +
      "Open the lead and hold it, mark it sold, or push it to execution.";
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
      title: `Quotation ready — ${lead.ref}`,
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
