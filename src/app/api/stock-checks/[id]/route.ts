import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { hasModule } from "@/lib/modules";

export const runtime = "nodejs";

type ReplyStatus = "available" | "partial" | "out";

interface ReplyItem {
  no: number;
  status: ReplyStatus;
  note?: string;
}

interface RawReplyItem {
  no?: unknown;
  status?: unknown;
  note?: unknown;
}

function normalizeReply(
  raw: unknown,
  expectedNos: Set<number>,
): { ok: true; items: ReplyItem[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "reply must be an array, one entry per item" };
  }
  const out: ReplyItem[] = [];
  const seen = new Set<number>();
  for (const r of raw as RawReplyItem[]) {
    const no = Number(r.no);
    if (!Number.isFinite(no) || !expectedNos.has(no)) {
      return { ok: false, error: `unknown item no: ${String(r.no)}` };
    }
    if (seen.has(no)) {
      return { ok: false, error: `duplicate reply for item no ${no}` };
    }
    seen.add(no);
    const status = String(r.status);
    if (status !== "available" && status !== "partial" && status !== "out") {
      return { ok: false, error: `invalid status for item ${no}: ${status}` };
    }
    const note = typeof r.note === "string" ? r.note.trim() : "";
    out.push({ no, status: status as ReplyStatus, ...(note ? { note } : {}) });
  }
  // Every item must be answered before submission. UI enforces this
  // already by disabling the submit button until all rows are set, but
  // we re-check server-side so a stale tab can't sneak a half-finished
  // reply through.
  for (const n of expectedNos) {
    if (!seen.has(n)) {
      return { ok: false, error: `missing answer for item ${n}` };
    }
  }
  return { ok: true, items: out };
}

interface CheckRow {
  id: number;
  quotation_id: number;
  status: "pending" | "answered" | "cancelled";
  requested_by: number;
  answered_by: number | null;
  items_json: unknown;
  reply_json: unknown;
  storage_notes: string | null;
  created_at: string;
  answered_at: string | null;
}

async function loadCheck(id: number): Promise<CheckRow | null> {
  const q = sql();
  const rows = (await q`
    select id, quotation_id, status, requested_by, answered_by,
           items_json, reply_json, storage_notes, created_at, answered_at
    from quotation_stock_checks
    where id = ${id}
    limit 1
  `) as CheckRow[];
  return rows[0] ?? null;
}

/**
 * GET /api/stock-checks/[id] — single check.
 * Visible to the requester, any storage-module member, and admin /
 * viewer. Everyone else gets 403.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { id: idStr } = await ctx.params;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "bad id" }, { status: 400 });
    }
    const check = await loadCheck(id);
    if (!check) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const isAdmin = canReadAll(user);
    const isStorage = isAdmin || (await hasModule(user.id, "storage"));
    if (!isStorage && check.requested_by !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const q = sql();
    const ctxRows = (await q`
      select qq.ref, qq.project_name, qq.client_name, qq.folder_id,
             ru.username as requested_by_username,
             ru.display_name as requested_by_display_name,
             au.username as answered_by_username,
             au.display_name as answered_by_display_name
      from quotations qq
      left join users ru on ru.id = ${check.requested_by}
      left join users au on au.id = ${check.answered_by}
      where qq.id = ${check.quotation_id}
      limit 1
    `) as Array<Record<string, unknown>>;

    return NextResponse.json({
      check: { ...check, ...(ctxRows[0] ?? {}) },
    });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}

/**
 * PATCH /api/stock-checks/[id]  body: { reply: ReplyItem[], notes? }
 *
 * Storage-team submission. We require a reply entry for every item in
 * the snapshot so the requester never opens a half-answered checklist.
 * Status flips pending → answered atomically; subsequent PATCHes are
 * rejected so a check is effectively one-shot once submitted.
 *
 * Viewers are blocked by the global mutation middleware.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { id: idStr } = await ctx.params;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "bad id" }, { status: 400 });
    }

    const isAdmin = canReadAll(user);
    const isStorage = isAdmin || (await hasModule(user.id, "storage"));
    if (!isStorage) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const check = await loadCheck(id);
    if (!check) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (check.status !== "pending") {
      return NextResponse.json(
        { error: "this check has already been answered" },
        { status: 409 },
      );
    }

    const body = (await req.json()) as {
      reply?: unknown;
      notes?: string;
    };
    const snapshot = Array.isArray(check.items_json)
      ? (check.items_json as Array<{ no: number }>)
      : [];
    const expected = new Set<number>(snapshot.map((s) => Number(s.no)));
    const result = normalizeReply(body.reply, expected);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const notes =
      typeof body.notes === "string" && body.notes.trim()
        ? body.notes.trim()
        : null;

    const q = sql();
    await q`
      update quotation_stock_checks
      set status = 'answered',
          reply_json = ${JSON.stringify(result.items)}::jsonb,
          storage_notes = ${notes},
          answered_by = ${user.id},
          answered_at = now(),
          updated_at = now()
      where id = ${id}
    `;

    const updated = await loadCheck(id);
    return NextResponse.json({ check: updated });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}

/**
 * DELETE /api/stock-checks/[id] — requester cancels their own pending
 * check. Once answered, the row stays as audit history. Admins can
 * cancel anyone's pending check. Viewers are blocked by middleware.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { id: idStr } = await ctx.params;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "bad id" }, { status: 400 });
    }
    const check = await loadCheck(id);
    if (!check) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (check.status !== "pending") {
      return NextResponse.json(
        { error: "only pending checks can be cancelled" },
        { status: 409 },
      );
    }
    const isAdmin = canReadAll(user);
    if (!isAdmin && check.requested_by !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const q = sql();
    await q`
      update quotation_stock_checks
      set status = 'cancelled', updated_at = now()
      where id = ${id}
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}
