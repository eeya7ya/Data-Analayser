import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";

export const runtime = "nodejs";

/**
 * Purchase orders — the stage after a quotation is accepted by the client.
 * Each PO is owned by the user who created it and optionally links back to
 * the quotation + folder it came from so the accepted-quote trail stays
 * intact. Soft-delete mirrors the quotation model (nothing is ever hard-
 * deleted through the UI).
 */

interface PoRow {
  id: number;
  owner_id: number | null;
  quotation_id: number | null;
  folder_id: number | null;
  project_id: number | null;
  po_number: string;
  supplier: string | null;
  client_name: string | null;
  project_name: string | null;
  amount: string;
  currency: string;
  status: string;
  notes: string | null;
  issued_at: string | null;
  expected_at: string | null;
  created_at: string;
  updated_at: string;
  owner_username?: string | null;
  owner_display_name?: string | null;
  quotation_ref?: string | null;
  folder_name?: string | null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "crm");
    await ensureSchema();
    const q = sql();
    const projectIdParam = req.nextUrl.searchParams.get("project_id");
    if (projectIdParam) {
      const projectId = Number(projectIdParam);
      if (!Number.isFinite(projectId) || projectId <= 0) {
        return NextResponse.json({ purchaseOrders: [] });
      }
      const projectRows =
        canReadAll(user)
          ? ((await q`
              select po.id, po.owner_id, po.quotation_id, po.folder_id, po.project_id,
                     po.po_number, po.supplier, po.client_name, po.project_name,
                     po.amount, po.currency, po.status, po.notes,
                     po.issued_at, po.expected_at, po.created_at, po.updated_at,
                     qt.ref as quotation_ref,
                     f.name as folder_name
              from purchase_orders po
              left join quotations qt on qt.id = po.quotation_id
              left join client_folders f on f.id = po.folder_id
              where po.project_id = ${projectId} and po.deleted_at is null
              order by po.created_at desc
            `) as PoRow[])
          : ((await q`
              select po.id, po.owner_id, po.quotation_id, po.folder_id, po.project_id,
                     po.po_number, po.supplier, po.client_name, po.project_name,
                     po.amount, po.currency, po.status, po.notes,
                     po.issued_at, po.expected_at, po.created_at, po.updated_at,
                     qt.ref as quotation_ref,
                     f.name as folder_name
              from purchase_orders po
              left join quotations qt on qt.id = po.quotation_id
              left join client_folders f on f.id = po.folder_id
              where po.project_id = ${projectId}
                and po.owner_id = ${user.id}
                and po.deleted_at is null
              order by po.created_at desc
            `) as PoRow[]);
      return NextResponse.json({ purchaseOrders: projectRows });
    }
    const rows =
      canReadAll(user)
        ? ((await q`
            select po.id, po.owner_id, po.quotation_id, po.folder_id, po.project_id,
                   po.po_number, po.supplier, po.client_name, po.project_name,
                   po.amount, po.currency, po.status, po.notes,
                   po.issued_at, po.expected_at, po.created_at, po.updated_at,
                   u.username as owner_username,
                   u.display_name as owner_display_name,
                   qt.ref as quotation_ref,
                   f.name as folder_name
            from purchase_orders po
            left join users u on u.id = po.owner_id
            left join quotations qt on qt.id = po.quotation_id
            left join client_folders f on f.id = po.folder_id
            where po.deleted_at is null
            order by po.created_at desc
          `) as PoRow[])
        : ((await q`
            select po.id, po.owner_id, po.quotation_id, po.folder_id, po.project_id,
                   po.po_number, po.supplier, po.client_name, po.project_name,
                   po.amount, po.currency, po.status, po.notes,
                   po.issued_at, po.expected_at, po.created_at, po.updated_at,
                   qt.ref as quotation_ref,
                   f.name as folder_name
            from purchase_orders po
            left join quotations qt on qt.id = po.quotation_id
            left join client_folders f on f.id = po.folder_id
            where po.owner_id = ${user.id}
              and po.deleted_at is null
            order by po.created_at desc
          `) as PoRow[]);
    return NextResponse.json({ purchaseOrders: rows });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "crm");
    await ensureSchema();
    const body = (await req.json()) as {
      po_number?: string;
      quotation_id?: number | null;
      folder_id?: number | null;
      project_id?: number | null;
      supplier?: string | null;
      client_name?: string | null;
      project_name?: string | null;
      amount?: number | string;
      currency?: string;
      status?: string;
      notes?: string | null;
      issued_at?: string | null;
      expected_at?: string | null;
    };
    const poNumber = (body.po_number || "").trim();
    if (!poNumber) {
      return NextResponse.json(
        { error: "PO number is required" },
        { status: 400 },
      );
    }
    const q = sql();

    // If the caller sent quotation_id, use it to prefill client / project /
    // amount / folder from that quotation so the new PO inherits the
    // accepted-quote context without the user re-typing everything.
    let prefillClientName: string | null = body.client_name?.trim() || null;
    let prefillProjectName: string | null = body.project_name?.trim() || null;
    let prefillFolderId: number | null = body.folder_id ?? null;
    let prefillProjectId: number | null = body.project_id ?? null;
    let prefillAmount: number =
      typeof body.amount === "number"
        ? body.amount
        : Number(body.amount || 0) || 0;
    let quotationId: number | null = body.quotation_id ?? null;

    if (quotationId) {
      const qrows = (await q`
        select id, owner_id, folder_id, project_id, client_name, project_name, totals_json
        from quotations where id = ${quotationId} and deleted_at is null
      `) as Array<{
        id: number;
        owner_id: number | null;
        folder_id: number | null;
        project_id: number | null;
        client_name: string | null;
        project_name: string | null;
        totals_json: unknown;
      }>;
      if (qrows.length === 0) {
        return NextResponse.json(
          { error: "Linked quotation not found" },
          { status: 404 },
        );
      }
      if (user.role !== "admin" && qrows[0].owner_id !== user.id) {
        return NextResponse.json(
          { error: "Cannot link a quotation that isn't yours" },
          { status: 403 },
        );
      }
      prefillClientName = prefillClientName || qrows[0].client_name;
      prefillProjectName = prefillProjectName || qrows[0].project_name;
      prefillFolderId = prefillFolderId || qrows[0].folder_id;
      // Inherit project_id from the quotation when the caller didn't
      // explicitly override — keeps the PO filed alongside the
      // quotation it was issued for.
      prefillProjectId = prefillProjectId ?? qrows[0].project_id;
      if (!body.amount) {
        const tj = qrows[0].totals_json as
          | { grand_total?: number; total?: number }
          | string
          | null;
        const parsed =
          typeof tj === "string"
            ? (() => {
                try {
                  return JSON.parse(tj) as {
                    grand_total?: number;
                    total?: number;
                  };
                } catch {
                  return {} as { grand_total?: number; total?: number };
                }
              })()
            : tj || {};
        prefillAmount =
          Number(parsed.grand_total ?? parsed.total ?? 0) || 0;
      }
    }

    const currency = (body.currency || "JOD").trim() || "JOD";
    const status = (body.status || "open").trim() || "open";

    // Validate the resolved project_id against the user's ownership when
    // it's set. The PATCH path applies the same guard for symmetry.
    if (
      user.role !== "admin" &&
      prefillProjectId !== null &&
      prefillProjectId !== undefined
    ) {
      const projectRows = (await q`
        select owner_id from projects
        where id = ${prefillProjectId} and deleted_at is null
        limit 1
      `) as Array<{ owner_id: number | null }>;
      if (projectRows.length === 0 || projectRows[0].owner_id !== user.id) {
        return NextResponse.json(
          { error: "forbidden project" },
          { status: 403 },
        );
      }
    }

    const rows = (await q`
      insert into purchase_orders (
        owner_id, quotation_id, folder_id, project_id, po_number, supplier,
        client_name, project_name, amount, currency, status,
        notes, issued_at, expected_at
      )
      values (
        ${user.id}, ${quotationId}, ${prefillFolderId}, ${prefillProjectId},
        ${poNumber},
        ${body.supplier?.trim() || null}, ${prefillClientName},
        ${prefillProjectName}, ${prefillAmount}, ${currency}, ${status},
        ${body.notes?.trim() || null}, ${body.issued_at || null},
        ${body.expected_at || null}
      )
      returning id, owner_id, quotation_id, folder_id, project_id, po_number, supplier,
                client_name, project_name, amount, currency, status, notes,
                issued_at, expected_at, created_at, updated_at
    `) as PoRow[];
    return NextResponse.json({ purchaseOrder: rows[0] });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: "You already have a PO with that number" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "crm");
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const body = (await req.json()) as {
      po_number?: string;
      supplier?: string | null;
      client_name?: string | null;
      project_name?: string | null;
      amount?: number | string;
      currency?: string;
      status?: string;
      notes?: string | null;
      issued_at?: string | null;
      expected_at?: string | null;
      project_id?: number | null;
    };
    const q = sql();
    const owned = (await q`
      select id, owner_id from purchase_orders
      where id = ${id} and deleted_at is null
      limit 1
    `) as Array<{ id: number; owner_id: number | null }>;
    if (owned.length === 0) {
      return NextResponse.json({ error: "PO not found" }, { status: 404 });
    }
    if (user.role !== "admin" && owned[0].owner_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (body.po_number !== undefined) {
      const n = body.po_number.trim();
      if (!n) {
        return NextResponse.json(
          { error: "PO number cannot be empty" },
          { status: 400 },
        );
      }
      await q`update purchase_orders set po_number = ${n} where id = ${id}`;
    }
    if (body.supplier !== undefined) {
      await q`update purchase_orders set supplier = ${body.supplier?.trim() || null} where id = ${id}`;
    }
    if (body.client_name !== undefined) {
      await q`update purchase_orders set client_name = ${body.client_name?.trim() || null} where id = ${id}`;
    }
    if (body.project_name !== undefined) {
      await q`update purchase_orders set project_name = ${body.project_name?.trim() || null} where id = ${id}`;
    }
    if (body.amount !== undefined) {
      const amt = Number(body.amount) || 0;
      await q`update purchase_orders set amount = ${amt} where id = ${id}`;
    }
    if (body.currency !== undefined) {
      await q`update purchase_orders set currency = ${body.currency.trim() || "JOD"} where id = ${id}`;
    }
    if (body.status !== undefined) {
      await q`update purchase_orders set status = ${body.status.trim() || "open"} where id = ${id}`;
    }
    if (body.notes !== undefined) {
      await q`update purchase_orders set notes = ${body.notes?.trim() || null} where id = ${id}`;
    }
    if (body.issued_at !== undefined) {
      await q`update purchase_orders set issued_at = ${body.issued_at || null} where id = ${id}`;
    }
    if (body.expected_at !== undefined) {
      await q`update purchase_orders set expected_at = ${body.expected_at || null} where id = ${id}`;
    }
    if (body.project_id !== undefined) {
      // Setting null detaches the PO from any project. Setting a positive
      // value re-files it; verify ownership for non-admins so a malicious
      // caller can't park their PO under another user's project.
      const target = body.project_id;
      if (target !== null) {
        const projectRows = (await q`
          select owner_id from projects
          where id = ${target} and deleted_at is null
          limit 1
        `) as Array<{ owner_id: number | null }>;
        if (projectRows.length === 0) {
          return NextResponse.json(
            { error: "project not found" },
            { status: 404 },
          );
        }
        if (user.role !== "admin" && projectRows[0].owner_id !== user.id) {
          return NextResponse.json(
            { error: "forbidden project" },
            { status: 403 },
          );
        }
      }
      await q`update purchase_orders set project_id = ${target} where id = ${id}`;
    }
    await q`update purchase_orders set updated_at = now() where id = ${id}`;

    const rows = (await q`
      select id, owner_id, quotation_id, folder_id, po_number, supplier,
             client_name, project_name, amount, currency, status, notes,
             issued_at, expected_at, created_at, updated_at
      from purchase_orders where id = ${id}
    `) as PoRow[];
    return NextResponse.json({ purchaseOrder: rows[0] });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: "You already have a PO with that number" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "crm");
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const q = sql();
    const owned = (await q`
      select id, owner_id from purchase_orders
      where id = ${id} and deleted_at is null
      limit 1
    `) as Array<{ id: number; owner_id: number | null }>;
    if (owned.length === 0) {
      return NextResponse.json({ error: "PO not found" }, { status: 404 });
    }
    if (user.role !== "admin" && owned[0].owner_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Soft-delete: PO entries follow the same "nothing is ever hard-
    // deleted" invariant as quotations / folders. A future /trash
    // surface can restore them if needed.
    await q`
      update purchase_orders
      set deleted_at = now(), updated_at = now()
      where id = ${id}
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      {
        status:
          msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500,
      },
    );
  }
}
