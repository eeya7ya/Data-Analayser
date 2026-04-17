import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";

export const runtime = "nodejs";

interface MemberRow {
  team_id: number;
  user_id: number;
  role: string;
  username: string;
  display_name: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const { id } = await params;
    const q = sql();
    const team = (await q`select id, name from teams where id = ${Number(id)}`) as Array<{
      id: number;
      name: string;
    }>;
    if (!team[0]) throw new Error("NOT_FOUND");
    const members = (await q`
      select m.team_id, m.user_id, m.role, u.username, u.display_name
      from team_members m
      join users u on u.id = m.user_id
      where m.team_id = ${team[0].id}
      order by u.username asc
    `) as MemberRow[];
    return NextResponse.json({ team: team[0], members });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    await ensureSchema();
    await requireCrmEnabled();
    const { id } = await params;
    const body = (await req.json()) as { user_id?: number; role?: string };
    if (!body.user_id) throw new Error("BAD_REQUEST");
    const q = sql();
    await q`
      insert into team_members (team_id, user_id, role)
      values (${Number(id)}, ${body.user_id}, ${body.role ?? "member"})
      on conflict (team_id, user_id) do update set role = excluded.role
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    await ensureSchema();
    await requireCrmEnabled();
    const { id } = await params;
    const url = new URL(req.url);
    const userIdRaw = url.searchParams.get("user_id");
    const q = sql();
    if (userIdRaw) {
      await q`delete from team_members where team_id = ${Number(id)} and user_id = ${Number(userIdRaw)}`;
    } else {
      await q`delete from teams where id = ${Number(id)}`;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
