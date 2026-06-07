import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { logLeadEvent, sendLeadMessage } from "@/lib/leads";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/quotations/sales-accept — body { id: number }
 *
 * 1.4C — the salesperson who raised the RFQ accepts the quotation that
 * presales sent back. We stamp `sales_accepted_at` / `sales_accepted_by`
 * and ping the quotation author so they know it's good to proceed with
 * the sales-manager sign-off / client delivery.
 *
 * Caller must be the lead's creator (or admin). The quotation must have
 * been sent to sales — otherwise there's nothing to accept yet. The
 * existing `/api/quotations/approve` endpoint is the manager-level
 * sign-off and is left untouched; this lane is a softer "yes, this
 * matches what I asked for" from the original requester.
 *
 * Idempotent: re-accepting is a 200 no-op.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await ensureSchema();

    const body = (await req.json().catch(() => ({}))) as { id?: number };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    const q = sql();
    const quotationRows = (await q`
      select id, ref, project_name, owner_id, project_id, status,
             deleted_at, sent_to_sales_at, sales_accepted_at
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
      sales_accepted_at: string | null;
    }>;
    if (quotationRows.length === 0 || quotationRows[0].deleted_at) {
      return NextResponse.json({ error: "quotation not found" }, { status: 404 });
    }
    const quotation = quotationRows[0];

    if (!quotation.sent_to_sales_at) {
      return NextResponse.json(
        { error: "the quotation hasn't been sent to sales yet" },
        { status: 409 },
      );
    }

    // Find the lead's creator — that's the only person (besides admin) who
    // can accept on behalf of sales. We use the latest live lead under the
    // project, mirroring send-to-sales.
    let leadCreatorId: number | null = null;
    let leadId: number | null = null;
    let leadRef: string | null = null;
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

    const isAdmin = canReadAll(user);
    if (!isAdmin && (!leadCreatorId || leadCreatorId !== user.id)) {
      return NextResponse.json(
        {
          error:
            "only the salesperson who raised the RFQ may accept this quotation",
        },
        { status: 403 },
      );
    }

    if (quotation.sales_accepted_at) {
      return NextResponse.json({
        ok: true,
        unchanged: true,
        sales_accepted_at: quotation.sales_accepted_at,
      });
    }

    await q`
      update quotations
      set sales_accepted_at = now(),
          sales_accepted_by = ${user.id}
      where id = ${id}
    `;

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'quotation', ${id}, 'sales_accept',
              ${JSON.stringify({ lead_id: leadId })}::jsonb)
    `;

    if (quotation.owner_id && quotation.owner_id !== user.id) {
      const accepter = user.display_name || user.username;
      const subject = `[${quotation.ref}] Sales accepted the quotation`;
      const bodyText =
        `${accepter} accepted the quotation you sent.\n\n` +
        `Quotation: ${quotation.ref}${quotation.project_name ? ` — ${quotation.project_name}` : ""}\n\n` +
        `It's ready for the sales-manager sign-off and client delivery.`;
      await sendLeadMessage({
        leadId,
        senderId: user.id,
        recipientId: quotation.owner_id,
        kind: "quotation_accepted",
        subject,
        body: bodyText,
        link: `/quotation?id=${id}`,
      });
      void sendPushToUsers([quotation.owner_id], {
        title: subject,
        body: `${accepter} accepted ${quotation.ref}${leadRef ? ` · RFQ ${leadRef}` : ""}.`,
        url: `/quotation?id=${id}`,
        tag: `quotation-accepted-${id}`,
      });
      if (leadId) {
        await logLeadEvent(
          leadId,
          user.id,
          "quotation_accepted",
          `${accepter} accepted quotation ${quotation.ref}`,
          { quotation_id: id },
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
