import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";
import { logActivity } from "@/lib/crm/activity";

export const runtime = "nodejs";

interface DealRow {
  id: number;
  owner_id: number | null;
  pipeline_id: number | null;
  stage_id: number | null;
  company_id: number | null;
  contact_id: number | null;
  folder_id: number | null;
  quotation_id: number | null;
  title: string;
  amount: number;
  currency: string;
  probability: number;
  expected_close_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

async function loadOrThrow(id: number, userId: number, isAdmin: boolean): Promise<DealRow> {
  const q = sql();
  const rows = (await q`
    select id, owner_id, pipeline_id, stage_id, company_id, contact_id,
           folder_id, quotation_id, title, amount, currency, probability,
           expected_close_at, status, created_at, updated_at
    from deals where id = ${id} and deleted_at is null
  `) as DealRow[];
  if (!rows[0]) throw new Error("NOT_FOUND");
  if (!isAdmin && rows[0].owner_id !== userId) throw new Error("FORBIDDEN");
  return rows[0];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const { id } = await params;
    const deal = await loadOrThrow(Number(id), user.id, user.role === "admin");
    return NextResponse.json({ deal });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const { id } = await params;
    const existing = await loadOrThrow(Number(id), user.id, user.role === "admin");
    const body = (await req.json()) as Partial<DealRow>;
    const q = sql();
    const stageChanged = body.stage_id !== undefined && body.stage_id !== existing.stage_id;
    const rows = (await q`
      update deals set
        pipeline_id       = ${body.pipeline_id  !== undefined ? body.pipeline_id  : existing.pipeline_id},
        stage_id          = ${body.stage_id     !== undefined ? body.stage_id     : existing.stage_id},
        company_id        = ${body.company_id   !== undefined ? body.company_id   : existing.company_id},
        contact_id        = ${body.contact_id   !== undefined ? body.contact_id   : existing.contact_id},
        folder_id         = ${body.folder_id    !== undefined ? body.folder_id    : existing.folder_id},
        quotation_id      = ${body.quotation_id !== undefined ? body.quotation_id : existing.quotation_id},
        title             = ${body.title        !== undefined ? body.title        : existing.title},
        amount            = ${body.amount       !== undefined ? body.amount       : existing.amount},
        currency          = ${body.currency     !== undefined ? body.currency     : existing.currency},
        probability       = ${body.probability  !== undefined ? body.probability  : existing.probability},
        expected_close_at = ${body.expected_close_at !== undefined ? body.expected_close_at : existing.expected_close_at},
        status            = ${body.status       !== undefined ? body.status       : existing.status},
        updated_at        = now()
      where id = ${existing.id}
      returning id, owner_id, pipeline_id, stage_id, company_id, contact_id,
                folder_id, quotation_id, title, amount, currency, probability,
                expected_close_at, status, created_at, updated_at
    `) as DealRow[];
    await logActivity({
      ownerId: rows[0].owner_id,
      actorId: user.id,
      entityType: "deal",
      entityId: rows[0].id,
      verb: stageChanged ? "stage_changed" : "updated",
      meta: stageChanged ? { from: existing.stage_id, to: rows[0].stage_id } : undefined,
    });
    return NextResponse.json({ deal: rows[0] });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const { id } = await params;
    const existing = await loadOrThrow(Number(id), user.id, user.role === "admin");
    const q = sql();
    await q`update deals set deleted_at = now() where id = ${existing.id}`;
    await logActivity({
      ownerId: existing.owner_id,
      actorId: user.id,
      entityType: "deal",
      entityId: existing.id,
      verb: "deleted",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
