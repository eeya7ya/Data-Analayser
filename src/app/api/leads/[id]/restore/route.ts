import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { canClaimLead, logLeadEvent } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/restore — bring a junked lead back into the queue.
 *
 * Same permission set as junking (DELETE /api/leads/:id): any presales
 * role, the lead's creator, or an admin. Clears `deleted_at` so the lead
 * reappears in the active queue with its prior status / assignment intact.
 */
export async function POST(
  _req: NextRequest,
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

    const q = sql();
    const rows = (await q`
      select id, created_by, assigned_to_id, deleted_at
      from leads
      where id = ${leadId}
      limit 1
    `) as Array<{
      id: number;
      created_by: number | null;
      assigned_to_id: number | null;
      deleted_at: string | null;
    }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const lead = rows[0];
    const isOwner =
      lead.created_by === user.id || lead.assigned_to_id === user.id;
    if (!canReadAll(user) && !isOwner && !(await canClaimLead(user))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (!lead.deleted_at) {
      return NextResponse.json({ ok: true, alreadyActive: true });
    }

    await q`
      update leads
      set deleted_at = null, updated_at = now()
      where id = ${leadId}
    `;
    await logLeadEvent(leadId, user.id, "restored", "Restored from junk", {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
