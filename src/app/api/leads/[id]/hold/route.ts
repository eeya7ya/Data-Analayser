import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canDecideOutcome, logLeadEvent } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/hold
 *
 * Sales chooses to hold a received quotation rather than decide now. This
 * doesn't change the status (the lead stays in `quotation_sent`, waiting
 * on sales) — it just records a hold note on the timeline so the pause is
 * auditable and the next person sees why.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    if (!(await canDecideOutcome(user))) {
      return NextResponse.json(
        { error: "only sales can hold a lead" },
        { status: 403 },
      );
    }
    const { id } = await ctx.params;
    const leadId = Number(id);
    if (!Number.isFinite(leadId) || leadId <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as { note?: string };
    const note = (body.note || "").trim();

    const q = sql();
    const rows = (await q`
      select id, status from leads where id = ${leadId} and deleted_at is null
      limit 1
    `) as Array<{ id: number; status: string }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "lead not found" }, { status: 404 });
    }
    if (rows[0].status !== "quotation_sent") {
      return NextResponse.json(
        { error: "only a quotation awaiting a sales decision can be held" },
        { status: 409 },
      );
    }

    await q`update leads set updated_at = now() where id = ${leadId}`;
    await logLeadEvent(
      leadId,
      user.id,
      "held",
      note ? `On hold: ${note}` : "Put on hold by sales",
      {},
    );

    return NextResponse.json({ ok: true, status: "quotation_sent" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
