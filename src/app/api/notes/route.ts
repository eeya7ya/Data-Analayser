import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * My Notes — the user's private notebook. Every row is owned by, and only
 * ever visible to, its `user_id`.
 *
 *   GET  /api/notes  → all of the user's live notes, newest-edited first.
 *   POST /api/notes  body { title?, body? } → create a note, returns it.
 */

interface NoteRow {
  id: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    const q = sql();
    const rows = (await q`
      select id, title, body, created_at, updated_at
      from user_notes
      where user_id = ${user.id} and deleted_at is null
      order by updated_at desc
    `) as NoteRow[];
    return NextResponse.json({ notes: rows });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      body?: string;
    };
    const title = String(body.title ?? "").slice(0, 200).trim() || "Untitled note";
    const noteBody = String(body.body ?? "").slice(0, 100000);

    const q = sql();
    const rows = (await q`
      insert into user_notes (user_id, title, body)
      values (${user.id}, ${title}, ${noteBody})
      returning id, title, body, created_at, updated_at
    `) as NoteRow[];
    return NextResponse.json({ ok: true, note: rows[0] });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  const msg = err instanceof Error ? err.message : "UNKNOWN";
  const status =
    msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
  return NextResponse.json({ error: msg }, { status });
}
