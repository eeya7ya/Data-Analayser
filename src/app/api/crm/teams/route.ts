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
    // Single LEFT JOIN + GROUP BY replaces a correlated subquery that was
    // executing once per team row. At 1000× growth the subquery plan would
    // have become O(teams × members); the grouped join is O(members) with
    // an index seek on `team_members_team_idx`.
    const rows = (await q`
      select t.id, t.name, t.created_at,
             count(m.user_id)::int as member_count
      from teams t
      left join team_members m on m.team_id = t.id
      group by t.id, t.name, t.created_at
      order by t.name asc
      limit 500
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
