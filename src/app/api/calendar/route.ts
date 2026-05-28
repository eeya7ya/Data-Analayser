import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Personal Calendar Marker — strictly per-user. Every query is scoped to
 * the signed-in user's id, so one user can never see or touch another's
 * marks.
 *
 *   GET    /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
 *            → marks in the inclusive date range (defaults to a wide
 *              window when omitted).
 *   POST   /api/calendar   body { date, note, color }
 *            → upsert the mark for that day. An empty note deletes it, so
 *              "clear the note" round-trips cleanly.
 *   DELETE /api/calendar?date=YYYY-MM-DD
 *            → remove the mark for that day.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLORS = new Set(["red", "amber", "emerald", "sky", "violet", "slate"]);

interface MarkRow {
  mark_date: string;
  note: string;
  color: string;
  updated_at: string;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    // Sane default window (±1 year) when the client doesn't constrain.
    const fromDate = from && ISO_DATE.test(from) ? from : "1900-01-01";
    const toDate = to && ISO_DATE.test(to) ? to : "2999-12-31";

    const q = sql();
    const rows = (await q`
      select to_char(mark_date, 'YYYY-MM-DD') as mark_date, note, color,
             updated_at
      from calendar_marks
      where user_id = ${user.id}
        and mark_date between ${fromDate} and ${toDate}
      order by mark_date asc
    `) as MarkRow[];

    return NextResponse.json({ marks: rows });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const body = (await req.json()) as {
      date?: string;
      note?: string;
      color?: string;
    };
    const date = String(body.date ?? "");
    if (!ISO_DATE.test(date)) {
      return NextResponse.json(
        { error: "date must be YYYY-MM-DD" },
        { status: 400 },
      );
    }
    const note = String(body.note ?? "").slice(0, 2000).trim();
    const color = COLORS.has(String(body.color)) ? String(body.color) : "red";

    const q = sql();

    // Empty note → there's nothing to mark; treat as a delete so toggling
    // a day off doesn't leave an invisible empty row behind.
    if (!note) {
      await q`
        delete from calendar_marks
        where user_id = ${user.id} and mark_date = ${date}
      `;
      return NextResponse.json({ ok: true, deleted: true });
    }

    const rows = (await q`
      insert into calendar_marks (user_id, mark_date, note, color)
      values (${user.id}, ${date}, ${note}, ${color})
      on conflict (user_id, mark_date)
      do update set note = ${note}, color = ${color}, updated_at = now()
      returning to_char(mark_date, 'YYYY-MM-DD') as mark_date, note, color,
                updated_at
    `) as MarkRow[];

    return NextResponse.json({ ok: true, mark: rows[0] });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const date = String(searchParams.get("date") ?? "");
    if (!ISO_DATE.test(date)) {
      return NextResponse.json(
        { error: "date must be YYYY-MM-DD" },
        { status: 400 },
      );
    }
    const q = sql();
    await q`
      delete from calendar_marks
      where user_id = ${user.id} and mark_date = ${date}
    `;
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
