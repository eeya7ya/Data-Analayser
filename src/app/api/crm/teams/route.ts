import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";

export const runtime = "nodejs";

interface TeamRow {
  id: number;
  name: string;
  created_at: string;
  member_count?: number;
}

export async function GET() {
  try {
    await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const q = sql();
    const rows = (await q`
      select t.id, t.name, t.created_at,
             (select count(*)::int from team_members m where m.team_id = t.id) as member_count
      from teams t
      order by t.name asc
    `) as TeamRow[];
    return NextResponse.json({ teams: rows });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    await ensureSchema();
    await requireCrmEnabled();
    const body = (await req.json()) as { name?: string };
    const name = (body.name ?? "").trim();
    if (!name) throw new Error("BAD_REQUEST");
    const q = sql();
    const created = (await q`
      insert into teams (name) values (${name}) returning id, name, created_at
    `) as TeamRow[];
    return NextResponse.json({ team: created[0] }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
