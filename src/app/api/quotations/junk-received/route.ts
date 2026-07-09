import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { sendLeadMessage } from "@/lib/leads";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/quotations/junk-received — body { id, reason? }
 *
 * The salesperson a quotation was sent to decides it isn't a real deal and
 * junks it, instead of filing it. This is the recipient's own dismissal of a
 * received handoff — distinct from the sales-manager /reject sign-off — so it
 * is gated on being the recipient (or admin), not on a manager role. It stamps
 * rejected_at/by/reason (the existing "this quotation is dead" signal) so the
 * quotation drops out of the "to file" queue, and notifies the presales sender
 * so they know it was dismissed rather than lost in a bell.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await ensureSchema();

    const body = (await req.json().catch(() => ({}))) as {
      id?: number;
      reason?: string;
    };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const reason = String(body.reason ?? "").trim().slice(0, 2000);

    const q = sql();
    const isAdmin = canReadAll(user);
    const rows = (await q`
      select id, ref, project_name, sent_to_sales_to, sent_to_sales_by,
             deleted_at, rejected_at
      from quotations
      where id = ${id}
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      project_name: string | null;
      sent_to_sales_to: number | null;
      sent_to_sales_by: number | null;
      deleted_at: string | null;
      rejected_at: string | null;
    }>;
    if (rows.length === 0 || rows[0].deleted_at) {
      return NextResponse.json({ error: "quotation not found" }, { status: 404 });
    }
    const quotation = rows[0];

    if (!isAdmin && quotation.sent_to_sales_to !== user.id) {
      return NextResponse.json(
        { error: "this quotation wasn't sent to you" },
        { status: 403 },
      );
    }
    if (quotation.rejected_at) {
      return NextResponse.json({ ok: true, unchanged: true });
    }

    const storedReason = reason
      ? `Junked from received queue: ${reason}`
      : "Junked from received queue";
    await q`
      update quotations
      set rejected_at     = now(),
          rejected_by     = ${user.id},
          rejected_reason = ${storedReason},
          updated_at      = now()
      where id = ${id}
    `;

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'quotation', ${id}, 'junk_received',
              ${JSON.stringify({ reason })}::jsonb)
    `;

    // Let the presales author know their handoff was junked (not silently
    // dropped) so they can follow up or re-send a revised version.
    if (quotation.sent_to_sales_by && quotation.sent_to_sales_by !== user.id) {
      const actor = user.display_name || user.username;
      const projectLabel = quotation.project_name || "the quotation";
      await sendLeadMessage({
        leadId: null,
        senderId: user.id,
        recipientId: quotation.sent_to_sales_by,
        kind: "general",
        subject: `[${quotation.ref}] Junked by sales`,
        body:
          `${actor} junked ${quotation.ref} (${projectLabel}) from the received ` +
          `queue.${reason ? `\n\nReason: ${reason}` : ""}`,
        link: `/quotation?id=${id}`,
      });
      void sendPushToUsers([quotation.sent_to_sales_by], {
        title: `${quotation.ref} junked by sales`,
        body: reason || `${actor} junked ${quotation.ref}.`,
        url: `/quotation?id=${id}`,
        tag: `quotation-junked-${id}`,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
