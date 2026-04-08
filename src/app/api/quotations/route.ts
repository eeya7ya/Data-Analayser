import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

function genRef(): string {
  // QY<YYMMDD>MT<rand>
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const n = Math.floor(Math.random() * 90 + 10);
  return `QY${yy}${mm}${dd}MT${n}`;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const q = sql();
    if (id) {
      const rows = (await q`
        select * from quotations where id = ${Number(id)} limit 1
      `) as Array<Record<string, unknown>>;
      return NextResponse.json({ quotation: rows[0] || null });
    }
    const rows = (await q`
      select id, ref, project_name, client_name, site_name, created_at
      from quotations
      where owner_id = ${user.id} or ${user.role} = 'admin'
      order by id desc
      limit 100
    `) as Array<Record<string, unknown>>;
    return NextResponse.json({ quotations: rows });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const body = (await req.json()) as {
      project_name: string;
      client_name?: string;
      client_email?: string;
      client_phone?: string;
      sales_engineer?: string;
      prepared_by?: string;
      site_name?: string;
      tax_percent?: number;
      items: unknown[];
      totals?: Record<string, unknown>;
    };
    const ref = genRef();
    const q = sql();
    const rows = (await q`
      insert into quotations (
        ref, owner_id, project_name, client_name, client_email, client_phone,
        sales_engineer, prepared_by, site_name, tax_percent, items_json, totals_json
      ) values (
        ${ref}, ${user.id}, ${body.project_name}, ${body.client_name || null},
        ${body.client_email || null}, ${body.client_phone || null},
        ${body.sales_engineer || null}, ${body.prepared_by || user.username},
        ${body.site_name || "SITE"}, ${body.tax_percent ?? 16},
        ${JSON.stringify(body.items || [])}::jsonb,
        ${JSON.stringify(body.totals || {})}::jsonb
      )
      returning id, ref
    `) as Array<{ id: number; ref: string }>;
    return NextResponse.json({ quotation: rows[0] });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * PATCH — update an existing quotation. Used by the Catalog when the user has
 * selected an existing project and wants to merge newly-picked items into it,
 * or edit its header fields.
 *
 * Ownership: only the owner (or any admin) may update a quotation.
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const body = (await req.json()) as {
      id: number;
      project_name?: string;
      client_name?: string;
      client_email?: string;
      client_phone?: string;
      sales_engineer?: string;
      site_name?: string;
      tax_percent?: number;
      items?: unknown[];
      totals?: Record<string, unknown>;
    };
    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const q = sql();
    const existing = (await q`
      select id, owner_id from quotations where id = ${body.id} limit 1
    `) as Array<{ id: number; owner_id: number | null }>;
    if (existing.length === 0) {
      return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
    }
    if (existing[0].owner_id !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rows = (await q`
      update quotations set
        project_name   = coalesce(${body.project_name ?? null}, project_name),
        client_name    = coalesce(${body.client_name ?? null}, client_name),
        client_email   = coalesce(${body.client_email ?? null}, client_email),
        client_phone   = coalesce(${body.client_phone ?? null}, client_phone),
        sales_engineer = coalesce(${body.sales_engineer ?? null}, sales_engineer),
        site_name      = coalesce(${body.site_name ?? null}, site_name),
        tax_percent    = coalesce(${body.tax_percent ?? null}, tax_percent),
        items_json     = coalesce(${body.items ? JSON.stringify(body.items) : null}::jsonb, items_json),
        totals_json    = coalesce(${body.totals ? JSON.stringify(body.totals) : null}::jsonb, totals_json),
        updated_at     = now()
      where id = ${body.id}
      returning id, ref
    `) as Array<{ id: number; ref: string }>;
    return NextResponse.json({ quotation: rows[0] });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
