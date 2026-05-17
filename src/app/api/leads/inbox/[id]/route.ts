import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/leads/inbox/:id
 *
 * Toggles read state on a lead_message owned by the current user.
 *   Body: { read: boolean }  →  set / clear read_at.
 *
 * Only the recipient can mutate their own message; we never allow
 * one user to mark another's mail read.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { id } = await ctx.params;
    const messageId = Number(id);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as { read?: boolean };
    const markRead = body.read !== false; // default = mark read

    const q = sql();
    const updated = (await q`
      update lead_messages
      set read_at = ${markRead ? new Date() : null}
      where id = ${messageId} and recipient_id = ${user.id}
      returning id
    `) as Array<{ id: number }>;

    if (updated.length === 0) {
      return NextResponse.json(
        { error: "message not found or not yours" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
