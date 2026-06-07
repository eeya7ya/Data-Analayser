import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { canClaimLead, canTransition, logLeadEvent, sendLeadMessage } from "@/lib/leads";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/claim
 *
 * 1.4A shared-queue model. There is no manager distribution: any presales
 * person claims a lead off the shared queue to start working it.
 *
 *   body { action: "claim" }   (default) — self-assign. `new` → `in_progress`.
 *                              Rejected if someone else already holds it
 *                              (admins may take over).
 *   body { action: "release" } — hand the lead back to the queue.
 *                              `in_progress` → `new`, assignee cleared.
 *                              Allowed for the current owner or an admin.
 *
 * Claiming notifies the lead's creator (the salesperson) so they can see who
 * picked up their request and follow up.
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

    const body = (await req.json().catch(() => ({}))) as {
      action?: "claim" | "release";
    };
    const action = body.action === "release" ? "release" : "claim";

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
    const isAdmin = canReadAll(user);

    // ── Release back to the queue ──────────────────────────────────────────
    if (action === "release") {
      if (!isAdmin && lead.assigned_to_id !== user.id) {
        return NextResponse.json(
          { error: "only the current owner can release this lead" },
          { status: 403 },
        );
      }
      if (lead.status !== "in_progress") {
        return NextResponse.json(
          { error: "lead is not currently being worked" },
          { status: 409 },
        );
      }
      await q`
        update leads
        set assigned_to_id = null,
            assigned_at    = null,
            status         = 'new',
            updated_at     = now()
        where id = ${leadId}
      `;
      await logLeadEvent(leadId, user.id, "released", "Released back to the queue", {
        previous_assignee_id: lead.assigned_to_id,
      });
      return NextResponse.json({ ok: true, status: "new" });
    }

    // ── Claim (self-assign) ─────────────────────────────────────────────────
    if (!(await canClaimLead(user))) {
      return NextResponse.json(
        { error: "only presales can claim leads" },
        { status: 403 },
      );
    }
    // 1.4D — the silent self-claim path is deprecated. Non-admin claims
    // MUST go through POST /api/leads/:id/assign-and-claim so the lead is
    // filed under a Company / Individual → Client → Project before it
    // leaves the queue. Admins retain the silent path for emergency
    // overrides; everyone else gets bounced back to the assign page.
    if (!isAdmin) {
      return NextResponse.json(
        {
          error:
            "Use the assignment page to claim this lead — silent claims are no longer allowed.",
          assign_url: `/leads/${leadId}/assign`,
        },
        { status: 409 },
      );
    }
    if (lead.assigned_to_id === user.id) {
      return NextResponse.json({ ok: true, status: "in_progress" });
    }
    if (lead.status === "new" && !canTransition("new", "in_progress")) {
      return NextResponse.json({ error: "transition not allowed" }, { status: 409 });
    }

    await q`
      update leads
      set assigned_to_id = ${user.id},
          assigned_at    = now(),
          status         = 'in_progress',
          updated_at     = now()
      where id = ${leadId}
    `;

    const claimer = user.display_name || user.username;
    const tookOver = Boolean(lead.assigned_to_id);
    await logLeadEvent(
      leadId,
      user.id,
      tookOver ? "reclaimed" : "claimed",
      tookOver ? `${claimer} took over the lead` : `${claimer} claimed the lead`,
      { previous_assignee_id: lead.assigned_to_id ?? null },
    );

    // Tell the salesperson who opened the lead that presales is now on it.
    if (lead.created_by && lead.created_by !== user.id) {
      await sendLeadMessage({
        leadId,
        senderId: user.id,
        recipientId: lead.created_by,
        kind: "general",
        subject: `[Lead ${lead.ref}] Picked up by presales`,
        body:
          `${claimer} is now working on your lead.\n\n` +
          `Title: ${lead.title}\n\n` +
          `You can follow its progress from the lead page.`,
      });
      void sendPushToUsers([lead.created_by], {
        title: `Presales picked up ${lead.ref}`,
        body: `${claimer} is now working on "${lead.title}".`,
        url: `/leads/${leadId}`,
        tag: `lead-claimed-${leadId}`,
      });
    }

    return NextResponse.json({ ok: true, status: "in_progress" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
