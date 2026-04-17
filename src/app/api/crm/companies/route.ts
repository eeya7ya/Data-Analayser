import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";
import { logActivity } from "@/lib/crm/activity";

export const runtime = "nodejs";

interface CompanyRow {
  id: number;
  owner_id: number | null;
  folder_id: number | null;
  name: string;
  website: string | null;
  industry: string | null;
  size_bucket: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Populated by GET list only — aggregated cross-module counters so the
  // CRM companies page can show the quotation/deal fan-out per row.
  quotation_count?: number;
  contact_count?: number;
  deal_count?: number;
}

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const q = sql();
    // Enrich with per-company counts so the list view can show "X quotations
    // · Y contacts · Z deals" without every row triggering its own detail
    // fetch. Left-joins with aggregated subqueries keep the plan cheap even
    // with 500 companies.
    const rows = (user.role === "admin"
      ? await q`
          select c.id, c.owner_id, c.folder_id, c.name, c.website, c.industry,
                 c.size_bucket, c.notes, c.created_at, c.updated_at,
                 coalesce(qc.cnt, 0)::int as quotation_count,
                 coalesce(cc.cnt, 0)::int as contact_count,
                 coalesce(dc.cnt, 0)::int as deal_count
          from companies c
          left join lateral (
            select count(*)::int as cnt from quotations q
            where q.company_id = c.id and q.deleted_at is null
          ) qc on true
          left join lateral (
            select count(*)::int as cnt from contacts ct
            where ct.company_id = c.id and ct.deleted_at is null
          ) cc on true
          left join lateral (
            select count(*)::int as cnt from deals d
            where d.company_id = c.id and d.deleted_at is null
          ) dc on true
          where c.deleted_at is null
          order by c.updated_at desc
          limit 500
        `
      : await q`
          select c.id, c.owner_id, c.folder_id, c.name, c.website, c.industry,
                 c.size_bucket, c.notes, c.created_at, c.updated_at,
                 coalesce(qc.cnt, 0)::int as quotation_count,
                 coalesce(cc.cnt, 0)::int as contact_count,
                 coalesce(dc.cnt, 0)::int as deal_count
          from companies c
          left join lateral (
            select count(*)::int as cnt from quotations q
            where q.company_id = c.id and q.deleted_at is null
          ) qc on true
          left join lateral (
            select count(*)::int as cnt from contacts ct
            where ct.company_id = c.id and ct.deleted_at is null
          ) cc on true
          left join lateral (
            select count(*)::int as cnt from deals d
            where d.company_id = c.id and d.deleted_at is null
          ) dc on true
          where c.owner_id = ${user.id} and c.deleted_at is null
          order by c.updated_at desc
          limit 500
        `) as CompanyRow[];
    return NextResponse.json({ companies: rows });
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
    const body = (await req.json()) as Partial<CompanyRow>;
    const name = (body.name ?? "").trim();
    if (!name) throw new Error("BAD_REQUEST");
    const q = sql();

    // Auto-create a matching client_folders row so the new company is
    // immediately usable from /quotation and /designer. The Quotations
    // module treats folder_id as the primary client anchor, so without
    // this link a CRM-created company would be invisible over there.
    // We never create the folder if one was supplied, and we re-use any
    // existing same-named folder owned by the user to avoid duplicates.
    let folderId = body.folder_id ?? null;
    if (folderId == null) {
      const existingFolder = (await q`
        select id from client_folders
        where owner_id = ${user.id}
          and deleted_at is null
          and lower(name) = ${name.toLowerCase()}
        limit 1
      `) as Array<{ id: number }>;
      if (existingFolder[0]) {
        folderId = existingFolder[0].id;
      } else {
        const newFolder = (await q`
          insert into client_folders (name, owner_id, client_company)
          values (${name}, ${user.id}, ${body.notes ?? null})
          on conflict (owner_id, name) do nothing
          returning id
        `) as Array<{ id: number }>;
        // on conflict branch — just look it up.
        if (newFolder[0]) {
          folderId = newFolder[0].id;
        } else {
          const reread = (await q`
            select id from client_folders
            where owner_id = ${user.id}
              and deleted_at is null
              and lower(name) = ${name.toLowerCase()}
            limit 1
          `) as Array<{ id: number }>;
          folderId = reread[0]?.id ?? null;
        }
      }
    }

    const rows = (await q`
      insert into companies (owner_id, folder_id, name, website, industry, size_bucket, notes)
      values (
        ${user.id},
        ${folderId},
        ${name},
        ${body.website ?? null},
        ${body.industry ?? null},
        ${body.size_bucket ?? null},
        ${body.notes ?? null}
      )
      returning id, owner_id, folder_id, name, website, industry, size_bucket,
                notes, created_at, updated_at
    `) as CompanyRow[];
    const created = rows[0];
    await logActivity({
      ownerId: created.owner_id,
      actorId: user.id,
      entityType: "company",
      entityId: created.id,
      verb: "created",
      meta: { name: created.name, folder_id: created.folder_id },
    });
    return NextResponse.json({ company: created }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
