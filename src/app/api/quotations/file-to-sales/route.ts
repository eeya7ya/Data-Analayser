import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { sendLeadMessage } from "@/lib/leads";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/quotations/file-to-sales
 *
 * The receiving side of "Send to sales". The salesperson a quotation was
 * routed to (quotations.sent_to_sales_to = me) files it under THEIR own
 * Company / Client → Project tree — the same pick-or-create flow presales use
 * to claim a lead (see /api/leads/:id/assign-and-claim), applied to a
 * quotation instead of a lead.
 *
 * Body:
 *   {
 *     id: number,                                   // the quotation
 *     kind: 'company' | 'individual',
 *     company: { id?: number, name?: string },      // company branch only
 *     folder:  { id?: number, name?: string, email?: string, phone?: string },
 *     project: { id?: number, name?: string, description?: string },
 *   }
 *
 * Resolution rules (per node): `id` present → use that record (must be the
 * caller's own, or the caller is admin); otherwise create a fresh one owned by
 * the caller from `name`. On success the quotation is re-pointed at the
 * resolved company / client / project, marked reviewed by sales
 * (sales_accepted_at/by), and the presales sender is notified.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await ensureSchema();

    const body = (await req.json().catch(() => ({}))) as {
      id?: number;
      kind?: "company" | "individual";
      company?: { id?: number; name?: string };
      folder?: { id?: number; name?: string; email?: string; phone?: string };
      project?: { id?: number; name?: string; description?: string };
    };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const kind: "company" | "individual" =
      body.kind === "company" ? "company" : "individual";

    const q = sql();
    const isAdmin = canReadAll(user);

    const rows = (await q`
      select id, ref, project_name, sent_to_sales_to, sent_to_sales_by, deleted_at
      from quotations
      where id = ${id}
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      project_name: string | null;
      sent_to_sales_to: number | null;
      sent_to_sales_by: number | null;
      deleted_at: string | null;
    }>;
    if (rows.length === 0 || rows[0].deleted_at) {
      return NextResponse.json({ error: "quotation not found" }, { status: 404 });
    }
    const quotation = rows[0];

    // Only the salesperson the quotation was routed to (or an admin) can file
    // it. Everyone else has no business re-homing someone else's received deal.
    if (!isAdmin && quotation.sent_to_sales_to !== user.id) {
      return NextResponse.json(
        { error: "this quotation wasn't sent to you" },
        { status: 403 },
      );
    }

    // ── Resolve company ────────────────────────────────────────────────────
    let companyId: number | null = null;
    if (kind === "company") {
      const cIdRaw = body.company?.id;
      if (Number.isInteger(cIdRaw) && Number(cIdRaw) > 0) {
        const found = (await q`
          select id from companies
          where id = ${Number(cIdRaw)} and deleted_at is null
            and (${isAdmin}::boolean = true or owner_id = ${user.id})
          limit 1
        `) as Array<{ id: number }>;
        if (found.length === 0) {
          return NextResponse.json(
            { error: "selected company not found" },
            { status: 404 },
          );
        }
        companyId = found[0].id;
      } else {
        const name = String(body.company?.name ?? "").trim();
        if (!name) {
          return NextResponse.json(
            { error: "company name is required when creating a new one" },
            { status: 400 },
          );
        }
        const created = (await q`
          insert into companies (owner_id, name)
          values (${user.id}, ${name})
          returning id
        `) as Array<{ id: number }>;
        companyId = created[0].id;
      }
    }

    // ── Resolve folder (client) ────────────────────────────────────────────
    let folderId: number;
    let folderName: string;
    const fIdRaw = body.folder?.id;
    if (Number.isInteger(fIdRaw) && Number(fIdRaw) > 0) {
      const found = (await q`
        select id, name, company_id from client_folders
        where id = ${Number(fIdRaw)} and deleted_at is null
          and (${isAdmin}::boolean = true or owner_id = ${user.id})
        limit 1
      `) as Array<{ id: number; name: string; company_id: number | null }>;
      if (found.length === 0) {
        return NextResponse.json(
          { error: "selected client folder not found" },
          { status: 404 },
        );
      }
      folderId = found[0].id;
      folderName = found[0].name;
      if (found[0].company_id !== null) companyId = found[0].company_id;
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
      const created = (await q`
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
      folderId = created[0].id;
      folderName = name;
    }

    // ── Resolve project ────────────────────────────────────────────────────
    let projectId: number;
    const pIdRaw = body.project?.id;
    if (Number.isInteger(pIdRaw) && Number(pIdRaw) > 0) {
      const found = (await q`
        select id from projects
        where id = ${Number(pIdRaw)} and deleted_at is null
          and folder_id = ${folderId}
          and (${isAdmin}::boolean = true or owner_id = ${user.id})
        limit 1
      `) as Array<{ id: number }>;
      if (found.length === 0) {
        return NextResponse.json(
          {
            error:
              "selected project not found under that client (pick a project that belongs to this client, or create a new one)",
          },
          { status: 404 },
        );
      }
      projectId = found[0].id;
    } else {
      const name = String(body.project?.name ?? "").trim();
      if (!name) {
        return NextResponse.json(
          { error: "project name is required when creating a new one" },
          { status: 400 },
        );
      }
      const description = String(body.project?.description ?? "").trim() || null;
      const created = (await q`
        insert into projects (folder_id, owner_id, name, description, status)
        values (${folderId}, ${user.id}, ${name}, ${description}, 'open')
        returning id
      `) as Array<{ id: number }>;
      projectId = created[0].id;
    }

    // ── Re-home the quotation + mark it reviewed by sales ──────────────────
    await q`
      update quotations
      set company_id        = ${companyId},
          folder_id         = ${folderId},
          project_id        = ${projectId},
          client_name       = ${folderName},
          sales_accepted_at = now(),
          sales_accepted_by = ${user.id},
          -- Filing a deal takes it on, so clear any earlier junk/reject stamp
          -- (e.g. "File anyway" on a previously junked one).
          rejected_at       = null,
          rejected_by       = null,
          rejected_reason   = null,
          updated_at        = now()
      where id = ${id}
    `;

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'quotation', ${id}, 'filed_to_sales',
              ${JSON.stringify({
                company_id: companyId,
                folder_id: folderId,
                project_id: projectId,
              })}::jsonb)
    `;

    // Tell the presales author who handed it over that sales has taken it in.
    if (quotation.sent_to_sales_by && quotation.sent_to_sales_by !== user.id) {
      const filer = user.display_name || user.username;
      const projectLabel = quotation.project_name || "the quotation";
      await sendLeadMessage({
        leadId: null,
        senderId: user.id,
        recipientId: quotation.sent_to_sales_by,
        kind: "general",
        subject: `[${quotation.ref}] Received and filed by sales`,
        body:
          `${filer} received ${quotation.ref} (${projectLabel}) and filed it ` +
          `under a client / project on the sales side.`,
        link: `/quotation?id=${id}`,
      });
      void sendPushToUsers([quotation.sent_to_sales_by], {
        title: `${quotation.ref} received by sales`,
        body: `${filer} filed ${quotation.ref} under a client / project.`,
        url: `/quotation?id=${id}`,
        tag: `quotation-filed-${id}`,
      });
    }

    return NextResponse.json({
      ok: true,
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
