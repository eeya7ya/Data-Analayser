import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { logLeadEvent, sendLeadMessage } from "@/lib/leads";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/request-modification   { note? }
 *
 * The salesperson who raised the RFQ has reviewed the quotation presales
 * built and wants changes. This is NOT a fresh request to the shared queue —
 * it goes straight to the presales who designed it (the lead's assignee) as a
 * message + push, and is logged on the lead timeline.
 *
 * Allowed for the lead creator (the requesting salesperson) or an admin.
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
    const body = (await req.json().catch(() => ({}))) as { note?: string };
    const note = String(body.note || "").trim();

    const q = sql();
    const rows = (await q`
      select id, ref, title, created_by, assigned_to_id
      from leads where id = ${leadId} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      title: string;
      created_by: number | null;
      assigned_to_id: number | null;
    }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "lead not found" }, { status: 404 });
    }
    const lead = rows[0];
    if (user.role !== "admin" && lead.created_by !== user.id) {
      return NextResponse.json(
        { error: "only the salesperson who raised the request can ask for changes" },
        { status: 403 },
      );
    }
    if (!lead.assigned_to_id) {
      return NextResponse.json(
        { error: "no presales has picked this up yet" },
        { status: 400 },
      );
    }

    const who = user.display_name || user.username;
    await sendLeadMessage({
      leadId,
      senderId: user.id,
      recipientId: lead.assigned_to_id,
      kind: "general",
      subject: `[Lead ${lead.ref}] Modification requested`,
      body:
        `${who} reviewed the quotation and is requesting changes.` +
        (note ? `\n\n${note}` : ""),
    });
    void sendPushToUsers([lead.assigned_to_id], {
      title: `Modification requested · ${lead.ref}`,
      body: note ? note.slice(0, 140) : `${who} wants changes to "${lead.title}".`,
      url: `/leads/${leadId}`,
      tag: `lead-modify-${leadId}`,
    });
    await logLeadEvent(
      leadId,
      user.id,
      "modification_requested",
      `${who} requested a modification to the quotation`,
      note ? { note } : {},
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
