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
