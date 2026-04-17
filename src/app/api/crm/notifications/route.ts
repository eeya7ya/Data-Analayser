import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";

export const runtime = "nodejs";

interface NotificationRow {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const q = sql();
    const rows = (await q`
      select id, kind, title, body, link, read_at, created_at
      from notifications
      where user_id = ${user.id}
      order by read_at nulls first, created_at desc
      limit 50
    `) as NotificationRow[];
    const unread = rows.filter((r) => r.read_at == null).length;
    return NextResponse.json(
      { notifications: rows, unread },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const body = (await req.json()) as { ids?: number[]; all?: boolean };
    const q = sql();
    if (body.all) {
      await q`update notifications set read_at = now() where user_id = ${user.id} and read_at is null`;
    } else if (Array.isArray(body.ids) && body.ids.length > 0) {
      await q`
        update notifications set read_at = now()
        where user_id = ${user.id} and id = any(${body.ids}::bigint[]) and read_at is null
      `;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
