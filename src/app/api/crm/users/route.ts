import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";
import { getOrSet } from "@/lib/cache";

export const runtime = "nodejs";

interface UserRow {
  id: number;
  username: string;
  display_name: string | null;
  role: string;
}

// The user list is referenced by almost every CRM dropdown (assignee pickers,
// team editors, ACL editors). It changes rarely relative to reads, so caching
// for 60 s is safe and eliminates a recurring query.
const USERS_TTL_MS = 60_000;

export async function GET() {
  try {
    await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const rows = await getOrSet<UserRow[]>("users:list", USERS_TTL_MS, async () => {
      const q = sql();
      return (await q`
        select id, username, display_name, role
        from users
        order by username asc
        limit 1000
      `) as UserRow[];
    });
    return NextResponse.json(
      { users: rows },
      {
        headers: {
          "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
        },
      },
    );
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
