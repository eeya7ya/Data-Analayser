import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canAuthorQuotation } from "@/lib/modules";
import { logLeadEvent, sendLeadMessage } from "@/lib/leads";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/quotations/send-to-sales — body { id: number, sales_user_id?: number }
 *
 * 1.4C — presales completes a quotation and hands it to a salesperson. We
 * stamp `sent_to_sales_at` / `sent_to_sales_by`, record the chosen recipient
 * in `sent_to_sales_to`, and ping that person with a TopBar notification +
 * Web Push pointing straight at the quotation viewer.
 *
 * The recipient is resolved as: the explicitly picked `sales_user_id` when
 * provided (validated to be a real salesperson), otherwise the creator of the
 * lead that raised the RFQ. A quotation that never came from a lead has no
 * default, so presales MUST pick someone — previously such a quotation was
 * stamped "sent" but reached nobody.
 *
 * Caller must be able to author quotations (admin / presales /
 * presales_manager) AND own the quotation (or be admin). Re-sends are
 * allowed — after sales requests changes and presales updates, the
 * presales author presses Send again and we restamp the timestamp, clear
 * `sales_accepted_at` (the prior acceptance no longer applies to the
 * revised version), and re-notify.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await ensureSchema();

    const body = (await req.json().catch(() => ({}))) as {
      id?: number;
      sales_user_id?: number;
    };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    if (!(await canAuthorQuotation(user))) {
      return NextResponse.json(
        { error: "only presales / admin can send quotations to sales" },
        { status: 403 },
      );
    }

    const q = sql();
    const quotationRows = (await q`
      select id, ref, project_name, owner_id, project_id, status,
             deleted_at, sent_to_sales_at
      from quotations
      where id = ${id}
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      project_name: string | null;
      owner_id: number | null;
      project_id: number | null;
      status: string | null;
      deleted_at: string | null;
      sent_to_sales_at: string | null;
    }>;
    if (quotationRows.length === 0 || quotationRows[0].deleted_at) {
      return NextResponse.json({ error: "quotation not found" }, { status: 404 });
    }
    const quotation = quotationRows[0];

    // Any quotation author (presales / presales_manager / admin) may send a
    // quotation to sales — not just the literal owner. `canAuthorQuotation`
    // was already checked above, so reaching here means the caller is on the
    // presales side; the owner-only restriction was hiding the button for
    // presales colleagues working the same project.
    if (quotation.status && quotation.status !== "active") {
      return NextResponse.json(
        { error: "only active quotations can be sent to sales" },
        { status: 409 },
      );
    }

    // Find the lead this quotation belongs to. The RFQ is project-scoped, so
    // we pull the newest live lead under the quotation's project. Quotations
    // without a project (legacy ad-hoc builds) can still be "sent to sales"
    // — we stamp the columns and skip the lead-driven notification.
    let leadCreatorId: number | null = null;
    let leadRef: string | null = null;
    let leadId: number | null = null;
    if (quotation.project_id) {
      const leadRows = (await q`
        select id, ref, created_by from leads
        where project_id = ${quotation.project_id}
          and deleted_at is null
        order by created_at desc
        limit 1
      `) as Array<{ id: number; ref: string; created_by: number | null }>;
      if (leadRows.length > 0) {
        leadId = leadRows[0].id;
        leadRef = leadRows[0].ref;
        leadCreatorId = leadRows[0].created_by;
      }
    }

    // Resolve WHO on the sales side should receive this. Presales can pick a
    // salesperson explicitly — required for a quotation that never came from a
    // received lead (no RFQ raiser to fall back to). When one isn't picked we
    // default to the lead's creator, preserving the original RFQ handoff.
    let recipientId: number | null = null;
    const chosenSalesId = Number(body.sales_user_id);
    if (Number.isInteger(chosenSalesId) && chosenSalesId > 0) {
      // Only a real salesperson / sales manager (or an admin) may be chosen —
      // mirrors the list the picker is populated from (/api/leads/users).
      const okRows = (await q`
        select u.id
        from users u
        left join user_module_roles r
          on r.user_id = u.id and r.revoked_at is null
        where u.id = ${chosenSalesId}
          and (u.role = 'admin'
               or (r.module = 'crm' and r.role in ('sales', 'sales_manager')))
        limit 1
      `) as Array<{ id: number }>;
      if (okRows.length === 0) {
        return NextResponse.json(
          { error: "the selected recipient is not a salesperson" },
          { status: 400 },
        );
      }
      recipientId = chosenSalesId;
    } else {
      recipientId = leadCreatorId;
    }

    // No explicit pick and no lead to inherit from → there is nobody to hand
    // it to. Ask the sender to choose rather than silently stamping it "sent"
    // with no recipient (the bug this whole flow fixes).
    if (!recipientId) {
      return NextResponse.json(
        {
          error:
            "Select a salesperson to receive this quotation — it isn't linked to a lead, so there's no default recipient.",
        },
        { status: 400 },
      );
    }

    await q`
      update quotations
      set sent_to_sales_at  = now(),
          sent_to_sales_by  = ${user.id},
          sent_to_sales_to  = ${recipientId},
          sales_accepted_at = null,
          sales_accepted_by = null
      where id = ${id}
    `;

    // 1.4D — once presales sends the quotation to sales, the lead's presales
    // work is done: stamp it so it drops out of the presales queue. Re-sends
    // keep it done. The ball is now in sales' court (review / accept /
    // request changes), tracked on the quotation itself, not the lead queue.
    if (leadId) {
      await q`
        update leads
        set quotation_id      = ${id},
            quotation_sent_at = now(),
            completed_at      = now(),
            updated_at        = now()
        where id = ${leadId}
      `;
    }

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'quotation', ${id}, 'send_to_sales',
              ${JSON.stringify({
                lead_id: leadId,
                recipient_id: recipientId,
                resent: Boolean(quotation.sent_to_sales_at),
              })}::jsonb)
    `;

    if (recipientId && recipientId !== user.id) {
      const sender = user.display_name || user.username;
      const subject = `[${quotation.ref}] Quotation ready — please review`;
      const projectLabel = quotation.project_name || "your request";
      const verb = quotation.sent_to_sales_at ? "updated and resent" : "sent";
      const bodyText =
        `${sender} ${verb} the quotation for ${projectLabel}.\n\n` +
        `Open it from the link below to approve, or request changes if anything needs tweaking.`;
      await sendLeadMessage({
        leadId,
        senderId: user.id,
        recipientId,
        kind: "quotation_sent_to_sales",
        subject,
        body: bodyText,
        link: `/quotation?id=${id}`,
      });
      void sendPushToUsers([recipientId], {
        title: subject,
        body: `${sender} ${verb} ${quotation.ref}${leadRef ? ` · RFQ ${leadRef}` : ""}.`,
        url: `/quotation?id=${id}`,
        tag: `quotation-sent-${id}`,
      });
      if (leadId) {
        await logLeadEvent(
          leadId,
          user.id,
          "quotation_sent_to_sales",
          `${sender} sent quotation ${quotation.ref} to sales`,
          { quotation_id: id, resent: Boolean(quotation.sent_to_sales_at) },
        );
      }
    }

    return NextResponse.json({ ok: true, lead_id: leadId, recipient_id: recipientId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
