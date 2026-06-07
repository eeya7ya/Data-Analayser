import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import {
  canClaimLead,
  canTransition,
  logLeadEvent,
  sendLeadMessage,
} from "@/lib/leads";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/assign-and-claim
 *
 * 1.4D — the forced presales claim flow. A presales user can't just
 * silently take a lead off the queue any more: they must pick (or create)
 * THEIR OWN Company / Individual → Client → Project tree, separate from
 * whatever loose hints sales attached when raising the RFQ. The whole
 * thing happens in one round-trip so the lead never sits half-assigned.
 *
 * Body:
 *   {
 *     kind: 'company' | 'individual',
 *     company: { id?: number, name?: string },   // company branch only
 *     folder:  { id?: number, name?: string,
 *                email?: string, phone?: string },
 *     project: { id?: number, name?: string, description?: string },
 *   }
 *
 * Resolution rules (per node):
 *   - `id` present  → use that record (must be reachable by the caller).
 *   - otherwise     → create a fresh one owned by the caller using the
 *                     supplied `name` (required for the create path).
 *
 * On success the lead is stamped with the resolved company / folder /
 * project ids, status flips to `in_progress`, and the lead's creator
 * gets the same notification as the simple claim flow plus an event
 * recording which tree the presales author tied it to.
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

    if (!(await canClaimLead(user))) {
      return NextResponse.json(
        { error: "only presales / admin can claim leads" },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      kind?: "company" | "individual";
      company?: { id?: number; name?: string };
      folder?: { id?: number; name?: string; email?: string; phone?: string };
      project?: { id?: number; name?: string; description?: string };
    };

    const kind: "company" | "individual" =
      body.kind === "company" ? "company" : "individual";
    const q = sql();

    const leadRows = (await q`
      select id, ref, title, status, assigned_to_id, created_by, project_id
      from leads
      where id = ${leadId} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      title: string;
      status: string;
      assigned_to_id: number | null;
      created_by: number | null;
      project_id: number | null;
    }>;
    if (leadRows.length === 0) {
      return NextResponse.json({ error: "lead not found" }, { status: 404 });
    }
    const lead = leadRows[0];
    const isAdmin = canReadAll(user);

    // Block claims on a lead someone else already owns (admins may take
    // over). Self re-claim is a no-op assignment but still re-files the
    // CRM tree, which is the only way to fix a wrong link post-claim.
    if (
      lead.assigned_to_id &&
      lead.assigned_to_id !== user.id &&
      !isAdmin
    ) {
      return NextResponse.json(
        { error: "this lead is already being worked by someone else" },
        { status: 409 },
      );
    }

    // ── Resolve company ────────────────────────────────────────────────────
    let companyId: number | null = null;
    if (kind === "company") {
      const cIdRaw = body.company?.id;
      if (Number.isInteger(cIdRaw) && Number(cIdRaw) > 0) {
        const rows = (await q`
          select id from companies
          where id = ${Number(cIdRaw)} and deleted_at is null
            and (${isAdmin}::boolean = true or owner_id = ${user.id})
          limit 1
        `) as Array<{ id: number }>;
        if (rows.length === 0) {
          return NextResponse.json(
            { error: "selected company not found" },
            { status: 404 },
          );
        }
        companyId = rows[0].id;
      } else {
        const name = String(body.company?.name ?? "").trim();
        if (!name) {
          return NextResponse.json(
            { error: "company name is required when creating a new one" },
            { status: 400 },
          );
        }
        const rows = (await q`
          insert into companies (owner_id, name)
          values (${user.id}, ${name})
          returning id
        `) as Array<{ id: number }>;
        companyId = rows[0].id;
      }
    }

    // ── Resolve folder (client) ────────────────────────────────────────────
    let folderId: number;
    const fIdRaw = body.folder?.id;
    if (Number.isInteger(fIdRaw) && Number(fIdRaw) > 0) {
      const rows = (await q`
        select id, company_id, kind from client_folders
        where id = ${Number(fIdRaw)} and deleted_at is null
          and (${isAdmin}::boolean = true or owner_id = ${user.id})
        limit 1
      `) as Array<{
        id: number;
        company_id: number | null;
        kind: "company" | "individual" | null;
      }>;
      if (rows.length === 0) {
        return NextResponse.json(
          { error: "selected client folder not found" },
          { status: 404 },
        );
      }
      folderId = rows[0].id;
      // If the existing folder belongs to a company, prefer that linkage so
      // the lead's company stays in sync with the picked client.
      if (rows[0].company_id !== null) companyId = rows[0].company_id;
    } else {
      const name = String(body.folder?.name ?? "").trim();
      if (!name) {
        return NextResponse.json(
          { error: "client name is required when creating a new one" },
          { status: 400 },
        );
      }
      const email = String(body.folder?.email ?? "").trim() || null;
      const phone = String(body.folder?.phone ?? "").trim() || null;
      const rows = (await q`
        insert into client_folders
          (name, owner_id, client_email, client_phone, kind, company_id)
        values
          (${name}, ${user.id}, ${email}, ${phone}, ${kind}, ${companyId})
        on conflict (owner_id, name) do update
          set client_email = coalesce(excluded.client_email, client_folders.client_email),
              client_phone = coalesce(excluded.client_phone, client_folders.client_phone),
              kind         = excluded.kind,
              company_id   = excluded.company_id
        returning id
      `) as Array<{ id: number }>;
      folderId = rows[0].id;
    }

    // ── Resolve project ────────────────────────────────────────────────────
    let projectId: number;
    const pIdRaw = body.project?.id;
    if (Number.isInteger(pIdRaw) && Number(pIdRaw) > 0) {
      const rows = (await q`
        select id, folder_id from projects
        where id = ${Number(pIdRaw)} and deleted_at is null
          and folder_id = ${folderId}
          and (${isAdmin}::boolean = true or owner_id = ${user.id})
        limit 1
      `) as Array<{ id: number; folder_id: number }>;
      if (rows.length === 0) {
        return NextResponse.json(
          {
            error:
              "selected project not found under that client (pick a project that belongs to this client, or create a new one)",
          },
          { status: 404 },
        );
      }
      projectId = rows[0].id;
    } else {
      const name = String(body.project?.name ?? "").trim();
      if (!name) {
        return NextResponse.json(
          { error: "project name is required when creating a new one" },
          { status: 400 },
        );
      }
      const description = String(body.project?.description ?? "").trim() || null;
      const rows = (await q`
        insert into projects (folder_id, owner_id, name, description, status)
        values (${folderId}, ${user.id}, ${name}, ${description}, 'open')
        returning id
      `) as Array<{ id: number }>;
      projectId = rows[0].id;
    }

    // ── Stamp the lead ─────────────────────────────────────────────────────
    if (lead.status === "new" && !canTransition("new", "in_progress")) {
      return NextResponse.json({ error: "transition not allowed" }, { status: 409 });
    }

    await q`
      update leads
      set assigned_to_id = ${user.id},
          assigned_at    = now(),
          status         = 'in_progress',
          company_id     = ${companyId},
          folder_id      = ${folderId},
          project_id     = ${projectId},
          updated_at     = now()
      where id = ${leadId}
    `;

    const claimer = user.display_name || user.username;
    await logLeadEvent(
      leadId,
      user.id,
      "claimed_with_assignment",
      `${claimer} claimed the lead and filed it under a presales project`,
      {
        company_id: companyId,
        folder_id: folderId,
        project_id: projectId,
        previous_project_id: lead.project_id,
      },
    );

    // Notify the salesperson who opened the lead. Mirrors the simple
    // claim notification but mentions the assignment so they immediately
    // know which presales structure their request landed in.
    if (lead.created_by && lead.created_by !== user.id) {
      await sendLeadMessage({
        leadId,
        senderId: user.id,
        recipientId: lead.created_by,
        kind: "general",
        subject: `[Lead ${lead.ref}] Picked up by presales`,
        body:
          `${claimer} is now working on your lead and filed it as a presales project.\n\n` +
          `Title: ${lead.title}\n\n` +
          `You can follow its progress from the lead page.`,
      });
      void sendPushToUsers([lead.created_by], {
        title: `Presales picked up ${lead.ref}`,
        body: `${claimer} is now working on "${lead.title}".`,
        url: `/leads/${leadId}`,
        tag: `lead-claimed-${leadId}`,
      });
    }

    return NextResponse.json({
      ok: true,
      status: "in_progress",
      company_id: companyId,
      folder_id: folderId,
      project_id: projectId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
