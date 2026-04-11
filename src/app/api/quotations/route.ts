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
      // Single-row lookup. Historically this returned even trashed rows so
      // the trash UI could build a preview; now that the Quotation Viewer
      // page fetches the row through this endpoint (instead of doing a
      // server-component DB query), we also have to enforce the
      // deleted_at filter and the owner check here. Regular users can
      // only read their own quotations; admins can read any row.
      const rows = (await q`
        select id, ref, owner_id, project_name, client_name, client_email,
               client_phone, sales_engineer, prepared_by, tax_percent,
               site_name, items_json, config_json, folder_id,
               created_at, updated_at, deleted_at
        from quotations
        where id = ${Number(id)}
        limit 1
      `) as Array<Record<string, unknown>>;
      const row = rows[0];
      if (!row) {
        return NextResponse.json({ quotation: null });
      }
      if (row.deleted_at) {
        // Trashed rows never leak through the viewer path. The dedicated
        // `/api/trash` endpoint is the only surface that hands out
        // soft-deleted quotations.
        return NextResponse.json({ quotation: null });
      }
      if (user.role !== "admin" && Number(row.owner_id) !== user.id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      return NextResponse.json({ quotation: row });
    }
    const rows =
      user.role === "admin"
        ? ((await q`
            select q.id, q.ref, q.project_name, q.client_name, q.site_name,
                   q.folder_id, q.owner_id, q.created_at, q.updated_at,
                   u.username as owner_username,
                   u.display_name as owner_display_name
            from quotations q
            left join users u on u.id = q.owner_id
            where q.deleted_at is null
            order by q.id desc
            limit 500
          `) as Array<Record<string, unknown>>)
        : ((await q`
            select id, ref, project_name, client_name, site_name,
                   folder_id, owner_id, created_at, updated_at
            from quotations
            where owner_id = ${user.id}
              and deleted_at is null
            order by id desc
            limit 200
          `) as Array<Record<string, unknown>>);
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
      select * from quotations
      where id = ${id} and deleted_at is null
      limit 1
    `) as Array<Record<string, unknown>>;
    if (existingRows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const existing = existingRows[0];
    if (user.role !== "admin" && existing.owner_id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // If the caller is moving the quotation into a folder, make sure the
    // target folder belongs to the quotation's owner (admins are exempt).
    if (
      user.role !== "admin" &&
      body.folder_id !== undefined &&
      body.folder_id !== null
    ) {
      const folderRows = (await q`
        select owner_id from client_folders
        where id = ${body.folder_id} and deleted_at is null
        limit 1
      `) as Array<{ owner_id: number | null }>;
      if (folderRows.length === 0) {
        return NextResponse.json({ error: "folder not found" }, { status: 404 });
      }
      if (folderRows[0].owner_id !== user.id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }

    // Only touch columns that the caller explicitly sent. The previous
    // implementation read `existing.*` and re-wrote every column, which
    // was catastrophic for jsonb fields: the round-trip
    //   postgres → JS value → JSON.stringify(...) → ::jsonb
    // is fragile, and for callers like MoveToFolder (which sends only
    // { folder_id }) it silently rewrote items_json / totals_json /
    // config_json with a possibly-empty or corrupted round-trip, wiping
    // saved quotations. This build-only-what-changed approach makes the
    // jsonb columns untouched unless the client actually sent new values.
    const ref = body.ref !== undefined ? body.ref : existing.ref;
    const pn =
      body.project_name !== undefined ? body.project_name : existing.project_name;
    const cn =
      body.client_name !== undefined ? body.client_name : existing.client_name;
    const ce =
      body.client_email !== undefined ? body.client_email : existing.client_email;
    const cp =
      body.client_phone !== undefined ? body.client_phone : existing.client_phone;
    const se =
      body.sales_engineer !== undefined
        ? body.sales_engineer
        : existing.sales_engineer;
    const pb =
      body.prepared_by !== undefined ? body.prepared_by : existing.prepared_by;
    const sn = body.site_name !== undefined ? body.site_name : existing.site_name;
    const tp = Number(
      body.tax_percent !== undefined ? body.tax_percent : existing.tax_percent,
    );
    const fid =
      body.folder_id !== undefined ? body.folder_id : existing.folder_id;

    const hasItems = body.items !== undefined;
    const hasTotals = body.totals !== undefined;
    const hasConfig = body.config !== undefined;

    // Serialize jsonb payloads up-front. When the client did not send a
    // jsonb field, we pass a benign `'null'` literal and the UPDATE's
    // CASE guard keeps the existing column value — PostgreSQL CASE
    // short-circuits so the placeholder is never actually evaluated.
    // `'null'::jsonb` is a valid cast just in case that guarantee slips.
    const itemsText = hasItems ? JSON.stringify(body.items) : "null";
    const totalsText = hasTotals ? JSON.stringify(body.totals) : "null";
    const configText = hasConfig ? JSON.stringify(body.config) : "null";

    const rows = (await q`
      update quotations set
        ref            = ${ref as string},
        project_name   = ${pn as string},
        client_name    = ${cn as string | null},
        client_email   = ${ce as string | null},
        client_phone   = ${cp as string | null},
        sales_engineer = ${se as string | null},
        prepared_by    = ${pb as string | null},
        site_name      = ${sn as string},
        tax_percent    = ${tp},
        items_json     = case when ${hasItems} then ${itemsText}::jsonb else items_json end,
        totals_json    = case when ${hasTotals} then ${totalsText}::jsonb else totals_json end,
        config_json    = case when ${hasConfig} then ${configText}::jsonb else config_json end,
        folder_id      = ${fid as number | null},
        updated_at     = now()
      where id = ${id}
      returning id, ref
    `) as unknown as Array<{ id: number; ref: string }>;
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
    // Folder selection is the CRM anchor: the client_* fields are sourced
    // from the folder unless the caller explicitly sent overrides. This is
    // what lets Designer.tsx present a UI where the user only types the
    // project name — the server still guarantees the persisted row matches
    // the folder so print output stays consistent.
    let folderClientName: string | null = null;
    let folderClientEmail: string | null = null;
    let folderClientPhone: string | null = null;
    if (folderId) {
      const folderRows = (await q`
        select owner_id, name, client_email, client_phone
        from client_folders
        where id = ${folderId} and deleted_at is null
        limit 1
      `) as Array<{
        owner_id: number | null;
        name: string;
        client_email: string | null;
        client_phone: string | null;
      }>;
      if (folderRows.length === 0) {
        return NextResponse.json({ error: "folder not found" }, { status: 404 });
      }
      if (user.role !== "admin" && folderRows[0].owner_id !== user.id) {
        return NextResponse.json({ error: "forbidden folder" }, { status: 403 });
      }
      folderClientName = folderRows[0].name || null;
      folderClientEmail = folderRows[0].client_email;
      folderClientPhone = folderRows[0].client_phone;
    }

    // Caller-provided values win; fall back to the folder's CRM data; finally
    // null. `body.client_name === ""` is treated as "no value given" so the
    // folder name always surfaces when Designer omits the field.
    const clientName =
      (body.client_name && body.client_name.trim()) || folderClientName;
    const clientEmail =
      (body.client_email && body.client_email.trim()) || folderClientEmail;
    const clientPhone =
      (body.client_phone && body.client_phone.trim()) || folderClientPhone;

    const rows = (await q`
      insert into quotations (
        ref, owner_id, project_name, client_name, client_email, client_phone,
        sales_engineer, prepared_by, site_name, tax_percent, items_json, totals_json, config_json, folder_id
      ) values (
        ${ref}, ${user.id}, ${body.project_name}, ${clientName},
        ${clientEmail}, ${clientPhone},
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

/**
 * Soft-delete a quotation. The row stays in the database with `deleted_at`
 * populated so the trash UI can restore it. We never offer a permanent-
 * delete endpoint — the junction box is forever.
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }
    const q = sql();
    const owned = (await q`
      select owner_id from quotations
      where id = ${id} and deleted_at is null
      limit 1
    `) as Array<{ owner_id: number | null }>;
    if (owned.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (user.role !== "admin" && owned[0].owner_id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    await q`
      update quotations set deleted_at = now(), updated_at = now()
      where id = ${id}
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
