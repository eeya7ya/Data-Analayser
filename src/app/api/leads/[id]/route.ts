import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getLeadVisibility, logLeadEvent } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET    /api/leads/:id  → full lead detail including timeline events.
 *                          Anyone with visibility into the lead can read.
 *
 * PATCH  /api/leads/:id  → update mutable fields: title, description,
 *                          priority, requested_timeline_at, company_id,
 *                          folder_id, contact_id. Restricted to the
 *                          assigned presales user, the creator, the
 *                          presales manager or admin. Status is NOT
 *                          mutated here — use the dedicated transition
 *                          endpoints so each one can run its own
 *                          notification fan-out.
 */

async function loadLead(id: number) {
  const q = sql();
  const rows = (await q`
    select l.*,
           cu.username as created_by_username, cu.display_name as created_by_name,
           au.username as assigned_to_username, au.display_name as assigned_to_name,
           pmu.username as presales_manager_username,
           exu.username as execution_assignee_username, exu.display_name as execution_assignee_name,
           ou.username as outcome_by_username,
           c.name as company_name,
           cf.name as folder_name,
           ct.first_name as contact_first_name,
           ct.last_name  as contact_last_name,
           ct.email      as contact_email,
           ct.phone      as contact_phone,
           qq.ref        as quotation_ref,
           qq.project_name as quotation_project_name,
           pj.name       as project_name,
           pf.filename   as boq_filename
    from leads l
    left join users cu on cu.id = l.created_by
    left join users au on au.id = l.assigned_to_id
    left join users pmu on pmu.id = l.presales_manager_id
    left join users exu on exu.id = l.execution_assignee_id
    left join users ou on ou.id = l.outcome_by
    left join companies c on c.id = l.company_id
    left join client_folders cf on cf.id = l.folder_id
    left join contacts ct on ct.id = l.contact_id
    left join quotations qq on qq.id = l.quotation_id
    left join projects pj on pj.id = l.project_id
    left join project_files pf on pf.id = l.boq_file_id
    where l.id = ${id} and l.deleted_at is null
    limit 1
  `) as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}

export async function GET(
  _req: NextRequest,
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
    const lead = await loadLead(leadId);
    if (!lead) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    // Read access is intentionally permissive: anybody with any CRM /
    // projects access can read any lead. Write access is restricted by
    // the transition endpoints. Granular row-level visibility would
    // need a separate scope helper; for now this matches the user's
    // requirement that "sales and presales can see read-only progress
    // of the lead lifecycle".
    const vis = await getLeadVisibility(user);
    if (!vis.full && !vis.sales && !vis.ownerOnly && !vis.execution) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const q = sql();
    const events = (await q`
      select e.id, e.verb, e.message, e.meta_json, e.created_at,
             u.username as actor_username, u.display_name as actor_name
      from lead_events e
      left join users u on u.id = e.actor_id
      where e.lead_id = ${leadId}
      order by e.created_at asc
    `) as Array<Record<string, unknown>>;

    return NextResponse.json({ lead, events });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(
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
    const lead = await loadLead(leadId);
    if (!lead) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const vis = await getLeadVisibility(user);
    const isOwner =
      lead.created_by === user.id || lead.assigned_to_id === user.id;
    if (!vis.full && !isOwner) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const body = (await req.json()) as Partial<{
      title: string;
      description: string | null;
      priority: string;
      requested_timeline_at: string | null;
      company_id: number | null;
      folder_id: number | null;
      contact_id: number | null;
      source: string | null;
    }>;

    const q = sql();
    const changes: string[] = [];

    if (typeof body.title === "string" && body.title.trim()) {
      await q`update leads set title = ${body.title.trim()}, updated_at = now() where id = ${leadId}`;
      changes.push("title");
    }
    if ("description" in body) {
      await q`update leads set description = ${body.description ?? null}, updated_at = now() where id = ${leadId}`;
      changes.push("description");
    }
    if ("priority" in body && body.priority) {
      await q`update leads set priority = ${body.priority}, updated_at = now() where id = ${leadId}`;
      changes.push("priority");
    }
    if ("requested_timeline_at" in body) {
      await q`update leads set requested_timeline_at = ${body.requested_timeline_at ?? null}, updated_at = now() where id = ${leadId}`;
      changes.push("requested_timeline_at");
    }
    if ("source" in body) {
      await q`update leads set source = ${body.source ?? null}, updated_at = now() where id = ${leadId}`;
      changes.push("source");
    }
    if ("company_id" in body) {
      await q`update leads set company_id = ${body.company_id ?? null}, updated_at = now() where id = ${leadId}`;
      changes.push("company_id");
    }
    if ("folder_id" in body) {
      await q`update leads set folder_id = ${body.folder_id ?? null}, updated_at = now() where id = ${leadId}`;
      changes.push("folder_id");
    }
    if ("contact_id" in body) {
      await q`update leads set contact_id = ${body.contact_id ?? null}, updated_at = now() where id = ${leadId}`;
      changes.push("contact_id");
    }

    if (changes.length > 0) {
      await logLeadEvent(leadId, user.id, "updated", `Edited: ${changes.join(", ")}`, {
        fields: changes,
      });
    }

    return NextResponse.json({ ok: true, changed: changes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
