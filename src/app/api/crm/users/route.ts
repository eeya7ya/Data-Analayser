import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";

export const runtime = "nodejs";

interface UserRow {
  id: number;
  username: string;
  display_name: string | null;
  role: string;
}

export async function GET() {
  try {
    await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const q = sql();
    const rows = (await q`
      select id, username, display_name, role
      from users
      order by username asc
    `) as UserRow[];
    return NextResponse.json({ users: rows });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
