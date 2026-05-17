import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leads/inbox       → list of lead_messages addressed to the
 *                              current user, newest first.
 *                              ?unread=1 to filter unread only.
 *
 * Each row carries enough context (subject, body, kind, lead_id, lead
 * ref/title) to render the email-style inbox without a follow-up query.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get("unread") === "1";

    const q = sql();
    const rows = unreadOnly
      ? ((await q`
          select m.id, m.lead_id, m.sender_id, m.kind, m.subject, m.body,
                 m.read_at, m.created_at,
                 s.username as sender_username, s.display_name as sender_name,
                 l.ref as lead_ref, l.title as lead_title, l.status as lead_status
          from lead_messages m
          left join users s on s.id = m.sender_id
          left join leads l on l.id = m.lead_id
          where m.recipient_id = ${user.id}
            and m.read_at is null
          order by m.created_at desc
          limit 200
        `) as Array<Record<string, unknown>>)
      : ((await q`
          select m.id, m.lead_id, m.sender_id, m.kind, m.subject, m.body,
                 m.read_at, m.created_at,
                 s.username as sender_username, s.display_name as sender_name,
                 l.ref as lead_ref, l.title as lead_title, l.status as lead_status
          from lead_messages m
          left join users s on s.id = m.sender_id
          left join leads l on l.id = m.lead_id
          where m.recipient_id = ${user.id}
          order by m.created_at desc
          limit 200
        `) as Array<Record<string, unknown>>);

    return NextResponse.json({ messages: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
