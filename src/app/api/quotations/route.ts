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
      select id, ref, project_name, client_name, site_name, folder_id, created_at
      from quotations
      where owner_id = ${user.id} or ${user.role} = 'admin'
      order by id desc
      limit 200
    `) as Array<Record<string, unknown>>;
    return NextResponse.json({ quotations: rows });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }
    const body = (await req.json()) as {
      ref?: string;
      project_name?: string;
      client_name?: string | null;
      client_email?: string | null;
      client_phone?: string | null;
      sales_engineer?: string | null;
      prepared_by?: string | null;
      site_name?: string;
      tax_percent?: number;
      items?: unknown[];
      totals?: Record<string, unknown>;
      config?: Record<string, unknown>;
      folder_id?: number | null;
    };
    const q = sql();
    const existingRows = (await q`
      select * from quotations where id = ${id} limit 1
    `) as Array<Record<string, unknown>>;
    if (existingRows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const existing = existingRows[0];
    if (user.role !== "admin" && existing.owner_id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const pick = <K extends keyof typeof body>(key: K, fallback: unknown) =>
      body[key] !== undefined ? body[key] : fallback;

    const next = {
      ref: pick("ref", existing.ref) as string,
      project_name: pick("project_name", existing.project_name) as string,
      client_name: pick("client_name", existing.client_name) as string | null,
      client_email: pick("client_email", existing.client_email) as string | null,
      client_phone: pick("client_phone", existing.client_phone) as string | null,
      sales_engineer: pick(
        "sales_engineer",
        existing.sales_engineer,
      ) as string | null,
      prepared_by: pick("prepared_by", existing.prepared_by) as string | null,
      site_name: pick("site_name", existing.site_name) as string,
      tax_percent: Number(pick("tax_percent", existing.tax_percent)),
      items_json: body.items ?? existing.items_json,
      totals_json: body.totals ?? existing.totals_json,
      config_json: body.config ?? existing.config_json,
      folder_id: pick("folder_id", existing.folder_id) as number | null,
    };

    const rows = (await q`
      update quotations set
        ref            = ${next.ref},
        project_name   = ${next.project_name},
        client_name    = ${next.client_name},
        client_email   = ${next.client_email},
        client_phone   = ${next.client_phone},
        sales_engineer = ${next.sales_engineer},
        prepared_by    = ${next.prepared_by},
        site_name      = ${next.site_name},
        tax_percent    = ${next.tax_percent},
        items_json     = ${JSON.stringify(next.items_json)}::jsonb,
        totals_json    = ${JSON.stringify(next.totals_json)}::jsonb,
        config_json    = ${JSON.stringify(next.config_json)}::jsonb,
        folder_id      = ${next.folder_id},
        updated_at     = now()
      where id = ${id}
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

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const body = (await req.json()) as {
      ref?: string;
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
      config?: Record<string, unknown>;
      folder_id?: number | null;
    };
    const ref = body.ref && body.ref.trim() ? body.ref.trim() : genRef();
    const folderId = body.folder_id || null;
    const q = sql();
    const rows = (await q`
      insert into quotations (
        ref, owner_id, project_name, client_name, client_email, client_phone,
        sales_engineer, prepared_by, site_name, tax_percent, items_json, totals_json, config_json, folder_id
      ) values (
        ${ref}, ${user.id}, ${body.project_name}, ${body.client_name || null},
        ${body.client_email || null}, ${body.client_phone || null},
        ${body.sales_engineer || null}, ${body.prepared_by || user.username},
        ${body.site_name || "SITE"}, ${body.tax_percent ?? 16},
        ${JSON.stringify(body.items || [])}::jsonb,
        ${JSON.stringify(body.totals || {})}::jsonb,
        ${JSON.stringify(body.config || {})}::jsonb,
        ${folderId}
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
