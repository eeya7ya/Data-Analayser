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
  // Populated by list GETs for the kanban card render.
  quotation_ref?: string | null;
  quotation_status?: string | null;
  company_name?: string | null;
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
            select d.id, d.owner_id, d.pipeline_id, d.stage_id, d.company_id,
                   d.contact_id, d.folder_id, d.quotation_id, d.title, d.amount,
                   d.currency, d.probability, d.expected_close_at, d.status,
                   d.created_at, d.updated_at,
                   q.ref    as quotation_ref,
                   q.status as quotation_status,
                   c.name   as company_name
            from deals d
            left join quotations q on q.id = d.quotation_id and q.deleted_at is null
            left join companies c on c.id = d.company_id and c.deleted_at is null
            where d.pipeline_id = ${Number(pipelineId)} and d.deleted_at is null
            order by d.id desc
            limit 1000
          `
        : await q`
            select d.id, d.owner_id, d.pipeline_id, d.stage_id, d.company_id,
                   d.contact_id, d.folder_id, d.quotation_id, d.title, d.amount,
                   d.currency, d.probability, d.expected_close_at, d.status,
                   d.created_at, d.updated_at,
                   q.ref    as quotation_ref,
                   q.status as quotation_status,
                   c.name   as company_name
            from deals d
            left join quotations q on q.id = d.quotation_id and q.deleted_at is null
            left join companies c on c.id = d.company_id and c.deleted_at is null
            where d.pipeline_id = ${Number(pipelineId)}
              and d.owner_id = ${user.id}
              and d.deleted_at is null
            order by d.id desc
            limit 1000
          `) as DealRow[];
    } else {
      rows = (user.role === "admin"
        ? await q`
            select d.id, d.owner_id, d.pipeline_id, d.stage_id, d.company_id,
                   d.contact_id, d.folder_id, d.quotation_id, d.title, d.amount,
                   d.currency, d.probability, d.expected_close_at, d.status,
                   d.created_at, d.updated_at,
                   q.ref    as quotation_ref,
                   q.status as quotation_status,
                   c.name   as company_name
            from deals d
            left join quotations q on q.id = d.quotation_id and q.deleted_at is null
            left join companies c on c.id = d.company_id and c.deleted_at is null
            where d.deleted_at is null
            order by d.updated_at desc
            limit 500
          `
        : await q`
            select d.id, d.owner_id, d.pipeline_id, d.stage_id, d.company_id,
                   d.contact_id, d.folder_id, d.quotation_id, d.title, d.amount,
                   d.currency, d.probability, d.expected_close_at, d.status,
                   d.created_at, d.updated_at,
                   q.ref    as quotation_ref,
                   q.status as quotation_status,
                   c.name   as company_name
            from deals d
            left join quotations q on q.id = d.quotation_id and q.deleted_at is null
            left join companies c on c.id = d.company_id and c.deleted_at is null
            where d.owner_id = ${user.id} and d.deleted_at is null
            order by d.updated_at desc
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
    const body = (await req.json()) as Partial<DealRow> & { title?: string };
    const title = (body.title ?? "").trim();
    if (!title) throw new Error("BAD_REQUEST");
    const q = sql();

    // If the caller is linking a quotation, look up its company/folder and
    // use them to backfill any fields they didn't explicitly set. This is
    // what makes "Create deal from quotation" a single-click action —
    // the user can POST { title, quotation_id } and everything else
    // populates automatically.
    let companyId = body.company_id ?? null;
    let contactId = body.contact_id ?? null;
    let folderId = body.folder_id ?? null;
    let amount = body.amount;
    let currency = body.currency;
    if (body.quotation_id) {
      const qrows = (await q`
        select q.id, q.owner_id, q.company_id, q.folder_id,
               q.totals_json, q.config_json
        from quotations q
        where q.id = ${body.quotation_id} and q.deleted_at is null
        limit 1
      `) as Array<{
        id: number;
        owner_id: number | null;
        company_id: number | null;
        folder_id: number | null;
        totals_json: Record<string, unknown> | null;
        config_json: Record<string, unknown> | null;
      }>;
      const qr = qrows[0];
      if (qr) {
        // Owner check — you can only link a quotation you can see.
        if (
          user.role !== "admin" &&
          qr.owner_id != null &&
          qr.owner_id !== user.id
        ) {
          throw new Error("FORBIDDEN");
        }
        if (companyId == null) companyId = qr.company_id;
        if (folderId == null) folderId = qr.folder_id;
        // Amount fallback — try totals.grand_total (Designer's convention).
        if (amount == null || amount === 0) {
          const t = qr.totals_json as Record<string, unknown> | null;
          const guess =
            (t && (t["grand_total"] as number | undefined)) ??
            (t && (t["grandTotal"] as number | undefined)) ??
            (t && (t["total"] as number | undefined));
          if (typeof guess === "number" && guess > 0) amount = guess;
        }
        if (!currency) {
          const cfg = qr.config_json as Record<string, unknown> | null;
          const cur = cfg && (cfg["currency"] as string | undefined);
          if (cur && typeof cur === "string") currency = cur;
        }
      }
    }

    // If we have a company but no contact, grab any one contact from that
    // company so the kanban card isn't blank-contact.
    if (companyId != null && contactId == null) {
      const ctRows = (await q`
        select id from contacts
        where company_id = ${companyId} and deleted_at is null
        order by id asc
        limit 1
      `) as Array<{ id: number }>;
      if (ctRows[0]) contactId = ctRows[0].id;
    }

    const created = (await q`
      insert into deals (owner_id, pipeline_id, stage_id, company_id, contact_id,
                         folder_id, quotation_id, title, amount, currency,
                         probability, expected_close_at, status)
      values (
        ${user.id},
        ${body.pipeline_id ?? null},
        ${body.stage_id ?? null},
        ${companyId},
        ${contactId},
        ${folderId},
        ${body.quotation_id ?? null},
        ${title},
        ${amount ?? 0},
        ${currency ?? "USD"},
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
