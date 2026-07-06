import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Single-note ops, always scoped to the owner so one user can never edit
 * or delete another's note even by guessing an id.
 *
 *   PATCH  /api/notes/:id  body { title?, body? } → update mutable fields.
 *   DELETE /api/notes/:id                          → soft-delete.
 */

interface NoteRow {
  id: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { id } = await ctx.params;
    const noteId = Number(id);
    if (!Number.isFinite(noteId) || noteId <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const body = (await req.json()) as { title?: string; body?: string };
    const hasTitle = typeof body.title === "string";
    const hasBody = typeof body.body === "string";
    if (!hasTitle && !hasBody) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }
    const title = hasTitle
      ? body.title!.slice(0, 200).trim() || "Untitled note"
      : null;
    const noteBody = hasBody ? body.body!.slice(0, 100000) : null;

    const q = sql();
    const rows = (await q`
      update user_notes
      set title = coalesce(${title}, title),
          body  = coalesce(${noteBody}, body),
          updated_at = now()
      where id = ${noteId} and user_id = ${user.id} and deleted_at is null
      returning id, title, body, created_at, updated_at
    `) as NoteRow[];
    if (rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, note: rows[0] });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { id } = await ctx.params;
    const noteId = Number(id);
    if (!Number.isFinite(noteId) || noteId <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const q = sql();
    // Permanent delete (no Trash). Not recoverable.
    const rows = (await q`
      delete from user_notes
      where id = ${noteId} and user_id = ${user.id}
      returning id
    `) as Array<{ id: number }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
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
