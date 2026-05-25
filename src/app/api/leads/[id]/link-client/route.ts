import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { hasModuleRole } from "@/lib/modules";
import { logLeadEvent } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/link-client
 *
 * Attach a client folder (company or individual) and optionally a contact
 * to a lead. The assigned presales user (or the creator / a presales
 * manager / admin) does this when they pick up a lead, so the work is
 * filed under the right client before they build the quotation.
 *
 * Body: { folder_id: number, contact_id?: number | null }
 *   - folder_id is required; the lead's company_id is derived from the
 *     folder when the folder is a company folder.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { id } = await ctx.params;
    const leadId = Number(id);
    if (!Number.isFinite(leadId) || leadId <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const body = (await req.json()) as {
      folder_id?: number;
      contact_id?: number | null;
    };
    const folderId = Number(body.folder_id);
    if (!Number.isInteger(folderId) || folderId <= 0) {
      return NextResponse.json({ error: "folder_id is required" }, { status: 400 });
    }

    const q = sql();
    const leadRows = (await q`
      select id, ref, assigned_to_id, created_by from leads
      where id = ${leadId} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      assigned_to_id: number | null;
      created_by: number | null;
    }>;
    if (leadRows.length === 0) {
      return NextResponse.json({ error: "lead not found" }, { status: 404 });
    }
    const lead = leadRows[0];

    const isOwner =
      lead.assigned_to_id === user.id || lead.created_by === user.id;
    const isAdmin = canReadAll(user);
    const isManager =
      isAdmin || (await hasModuleRole(user.id, "crm", "presales_manager"));
    if (!isAdmin && !isOwner && !isManager) {
      return NextResponse.json(
        { error: "only the assigned presales user can link a client" },
        { status: 403 },
      );
    }

    const folderRows = (await q`
      select id, name, kind, company_id from client_folders
      where id = ${folderId} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      name: string;
      kind: string | null;
      company_id: number | null;
    }>;
    if (folderRows.length === 0) {
      return NextResponse.json({ error: "client folder not found" }, { status: 404 });
    }
    const folder = folderRows[0];

    let contactId: number | null = null;
    if (body.contact_id != null) {
      const cid = Number(body.contact_id);
      if (Number.isInteger(cid) && cid > 0) {
        const cRows = (await q`
          select id from contacts where id = ${cid} and deleted_at is null limit 1
        `) as Array<{ id: number }>;
        if (cRows.length > 0) contactId = cid;
      }
    }

    await q`
      update leads
      set folder_id = ${folder.id},
          company_id = ${folder.company_id},
          contact_id = ${contactId},
          updated_at = now()
      where id = ${leadId}
    `;

    await logLeadEvent(
      leadId,
      user.id,
      "client_linked",
      `Linked to client: ${folder.name}`,
      { folder_id: folder.id, company_id: folder.company_id, contact_id: contactId },
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
