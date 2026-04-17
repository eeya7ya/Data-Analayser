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

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const url = new URL(req.url);
    const pipelineId = url.searchParams.get("pipeline_id");
    const q = sql();
    let rows: DealRow[];
    if (pipelineId) {
      rows = (user.role === "admin"
        ? await q`
            select id, owner_id, pipeline_id, stage_id, company_id, contact_id,
                   folder_id, quotation_id, title, amount, currency, probability,
                   expected_close_at, status, created_at, updated_at
            from deals
            where pipeline_id = ${Number(pipelineId)} and deleted_at is null
            order by id desc
            limit 1000
          `
        : await q`
            select id, owner_id, pipeline_id, stage_id, company_id, contact_id,
                   folder_id, quotation_id, title, amount, currency, probability,
                   expected_close_at, status, created_at, updated_at
            from deals
            where pipeline_id = ${Number(pipelineId)} and owner_id = ${user.id} and deleted_at is null
            order by id desc
            limit 1000
          `) as DealRow[];
    } else {
      rows = (user.role === "admin"
        ? await q`
            select id, owner_id, pipeline_id, stage_id, company_id, contact_id,
                   folder_id, quotation_id, title, amount, currency, probability,
                   expected_close_at, status, created_at, updated_at
            from deals
            where deleted_at is null
            order by updated_at desc
            limit 500
          `
        : await q`
            select id, owner_id, pipeline_id, stage_id, company_id, contact_id,
                   folder_id, quotation_id, title, amount, currency, probability,
                   expected_close_at, status, created_at, updated_at
            from deals
            where owner_id = ${user.id} and deleted_at is null
            order by updated_at desc
            limit 500
          `) as DealRow[];
    }
    return NextResponse.json({ deals: rows });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const body = (await req.json()) as Partial<DealRow>;
    const title = (body.title ?? "").trim();
    if (!title) throw new Error("BAD_REQUEST");
    const q = sql();
    const created = (await q`
      insert into deals (owner_id, pipeline_id, stage_id, company_id, contact_id,
                         folder_id, quotation_id, title, amount, currency,
                         probability, expected_close_at, status)
      values (
        ${user.id},
        ${body.pipeline_id ?? null},
        ${body.stage_id ?? null},
        ${body.company_id ?? null},
        ${body.contact_id ?? null},
        ${body.folder_id ?? null},
        ${body.quotation_id ?? null},
        ${title},
        ${body.amount ?? 0},
        ${body.currency ?? "USD"},
        ${body.probability ?? 0},
        ${body.expected_close_at ?? null},
        ${body.status ?? "open"}
      )
      returning id, owner_id, pipeline_id, stage_id, company_id, contact_id,
                folder_id, quotation_id, title, amount, currency, probability,
                expected_close_at, status, created_at, updated_at
    `) as DealRow[];
    await logActivity({
      ownerId: created[0].owner_id,
      actorId: user.id,
      entityType: "deal",
      entityId: created[0].id,
      verb: "created",
      meta: { title: created[0].title, amount: created[0].amount },
    });
    return NextResponse.json({ deal: created[0] }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
