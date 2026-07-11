import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { hasModuleRole, requireModuleAllowLegacy } from "@/lib/modules";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/quotations/complete — body { id: number }
 *
 * Sales closes a WON deal as fully done. Two situations reach here:
 *   • a supply-only / delivered-on-the-spot deal that never needs the
 *     projects team — stamping `completed_at` moves it straight to the
 *     terminal Completed stage on the pipeline;
 *   • a deal already in execution whose work is finished — the linked
 *     project (if any) is marked completed too, which is what the pipeline's
 *     Delivered stage keys off for transferred deals.
 *
 * Allowed for the same circle that marks outcomes: the owner, the recipient
 * salesperson (sent_to_sales_to / sales_accepted_by), sales managers and
 * admins. The deal must be Won (sales_outcome = accepted) or already
 * transferred to execution.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireModuleAllowLegacy(user, "crm");

    const isAdmin = canReadAll(user);
    const isSales =
      isAdmin ||
      (await hasModuleRole(user.id, "crm", "sales")) ||
      (await hasModuleRole(user.id, "crm", "sales_manager"));
    if (!isSales) {
      return NextResponse.json(
        { error: "only sales users can complete a deal" },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as { id?: number };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }

    const q = sql();
    const rows = (await q`
      select id, ref, owner_id, project_id, sales_outcome, transferred_at,
             completed_at, sent_to_sales_to, sales_accepted_by
      from quotations
      where id = ${id} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      owner_id: number | null;
      project_id: number | null;
      sales_outcome: string | null;
      transferred_at: string | null;
      completed_at: string | null;
      sent_to_sales_to: number | null;
      sales_accepted_by: number | null;
    }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const quotation = rows[0];

    const isSalesManager =
      isAdmin || (await hasModuleRole(user.id, "crm", "sales_manager"));
    const isRecipient =
      quotation.sent_to_sales_to === user.id ||
      quotation.sales_accepted_by === user.id;
    if (
      !isAdmin &&
      !isSalesManager &&
      !isRecipient &&
      quotation.owner_id !== user.id
    ) {
      return NextResponse.json(
        { error: "you can only complete quotations sent to you or owned by you" },
        { status: 403 },
      );
    }

    if (quotation.completed_at) {
      return NextResponse.json({ ok: true, alreadyCompleted: true });
    }
    if (quotation.sales_outcome !== "accepted" && !quotation.transferred_at) {
      return NextResponse.json(
        { error: "mark the deal as Won before completing it" },
        { status: 409 },
      );
    }

    await q`
      update quotations
      set completed_at = now(),
          completed_by = ${user.id},
          updated_at = now()
      where id = ${id}
    `;
    // A transferred deal's Delivered stage keys off the linked project being
    // completed — close that out too so the two never disagree.
    if (quotation.project_id) {
      await q`
        update projects
        set status = 'completed', updated_at = now()
        where id = ${quotation.project_id} and deleted_at is null
      `;
    }
    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'quotation', ${id}, 'deal_completed',
              ${JSON.stringify({ project_id: quotation.project_id })}::jsonb)
    `;

    // Keep the presales author in the loop on the closed deal.
    if (quotation.owner_id && quotation.owner_id !== user.id) {
      void sendPushToUsers([quotation.owner_id], {
        title: `${quotation.ref} completed`,
        body: `Marked completed by ${user.display_name || user.username}.`,
        url: `/quotation?id=${id}`,
        tag: `completed-${id}`,
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
