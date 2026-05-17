import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leads/inbox/count
 *
 * Lightweight badge endpoint for the TopBar — number of unread
 * lead_messages addressed to the current user. Always returns 200 (zero
 * for anonymous / no-CRM users) so the fetch never errors loudly.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ unread: 0 });
  await ensureSchema();
  const q = sql();
  const rows = (await q`
    select count(*)::int as n
    from lead_messages
    where recipient_id = ${user.id} and read_at is null
  `) as Array<{ n: number }>;
  return NextResponse.json({ unread: rows[0]?.n ?? 0 });
}
