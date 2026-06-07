import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { hasModule, hasModuleRole, requireModuleAllowLegacy } from "@/lib/modules";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Convert-to-Project handoffs.
 *
 *   POST  — a salesperson converts an APPROVED quotation into a project
 *           handoff: the line items are snapshotted as the BOQ and the
 *           client contacts / map location / priority / notes are
 *           captured. Status starts at `pending_assignment`.
 *   GET   — role-scoped list. Projects managers + admins see every
 *           pending/assigned handoff; the creating salesperson sees the
 *           ones they raised; an assigned member sees theirs.
 *
 * The actual roster entry is created by the assign route, which mirrors
 * into `project_assignments` (same contract as lead send-to-execution).
 */

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

async function canConvert(userId: number, role: string): Promise<boolean> {
  if (role === "admin" || role === "viewer") return true;
  if (await hasModuleRole(userId, "crm", "sales")) return true;
  if (await hasModuleRole(userId, "crm", "sales_manager")) return true;
  return false;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    // The handoff queue spans two modules: sales (crm) raise handoffs by
    // converting approved quotations; projects managers/members assign and
    // act on them. Read access is granted by EITHER module — gating on crm
    // alone wrongly 403s a projects manager who holds no crm role. Everyone
    // else falls through to the legacy-aware crm gate (keeps the no-grants
    // bypass; FORBIDDEN for unrelated single-module users).
    if (
      !canReadAll(user) &&
      !(await hasModule(user.id, "crm")) &&
      !(await hasModule(user.id, "projects"))
    ) {
      await requireModuleAllowLegacy(user, "crm");
    }

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status");
    const status =
      statusParam === "pending_assignment" ||
      statusParam === "assigned" ||
      statusParam === "completed" ||
      statusParam === "cancelled"
        ? statusParam
        : null;

    const isAdmin = canReadAll(user);
    const isProjectsManager =
      isAdmin || (await hasModuleRole(user.id, "projects", "manager"));

    const q = sql();
    // Visibility: managers/admins see all; everyone else sees handoffs
    // they created or are assigned to.
    const seeAll = isAdmin || isProjectsManager;
    const rows = (await q`
      select h.id, h.quotation_id, h.project_id, h.folder_id, h.created_by,
             h.status, h.contact_name, h.contact_phones, h.site_address,
             h.location_lat, h.location_lng, h.priority, h.notes,
             h.assigned_user_id, h.assigned_by, h.assigned_at, h.completed_at,
             h.created_at,
             jsonb_array_length(coalesce(h.boq_snapshot, '[]'::jsonb)) as boq_items,
             h.boq_snapshot,
             qq.ref as quotation_ref,
             p.name as project_name,
             cb.username as created_by_username,
             cb.display_name as created_by_display_name,
             au.username as assigned_username,
             au.display_name as assigned_display_name,
             cf.name as folder_name
      from project_handoffs h
      left join quotations qq on qq.id = h.quotation_id
      left join projects p on p.id = h.project_id
      left join client_folders cf on cf.id = h.folder_id
      left join users cb on cb.id = h.created_by
      left join users au on au.id = h.assigned_user_id
      where (${status}::text is null or h.status = ${status})
        and (
          ${seeAll}::boolean
          or h.created_by = ${user.id}
          or h.assigned_user_id = ${user.id}
        )
      order by
        case h.status when 'pending_assignment' then 0 when 'assigned' then 1 else 2 end,
        case h.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
        h.created_at desc
      limit 500
    `) as Array<Record<string, unknown> & { assigned_user_id: number | null; status: string }>;

    // Per-row completion right: the assigned member or any manager/admin
    // can close out an `assigned` handoff.
    const handoffs = rows.map((r) => ({
      ...r,
      can_complete:
        r.status === "assigned" && (seeAll || r.assigned_user_id === user.id),
    }));

    return NextResponse.json({ handoffs, can_assign: seeAll });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const s = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status: s });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireModuleAllowLegacy(user, "crm");

    if (!(await canConvert(user.id, user.role))) {
      return NextResponse.json(
        { error: "only sales users can convert a quotation to a project" },
        { status: 403 },
      );
    }

    const body = (await req.json()) as {
      quotation_id?: number;
      contact_name?: string | null;
      contact_phones?: string | null;
      site_address?: string | null;
      location_lat?: number | null;
      location_lng?: number | null;
      priority?: string | null;
      notes?: string | null;
    };

    const quotationId = Number(body.quotation_id);
    if (!Number.isInteger(quotationId) || quotationId <= 0) {
      return NextResponse.json({ error: "quotation_id is required" }, { status: 400 });
    }

    const q = sql();
    const rows = (await q`
      select id, owner_id, ref, project_name, client_name, client_phone,
             client_email, items_json, folder_id, project_id, approved_at
      from quotations
      where id = ${quotationId} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      owner_id: number | null;
      ref: string;
      project_name: string;
      client_name: string | null;
      client_phone: string | null;
      client_email: string | null;
      items_json: unknown;
      folder_id: number | null;
      project_id: number | null;
      approved_at: string | null;
    }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "quotation not found" }, { status: 404 });
    }
    const quotation = rows[0];

    const isAdmin = canReadAll(user);
    const isSalesManager =
      isAdmin || (await hasModuleRole(user.id, "crm", "sales_manager"));
    if (!isAdmin && !isSalesManager && quotation.owner_id !== user.id) {
      return NextResponse.json(
        { error: "you can only convert your own quotations" },
        { status: 403 },
      );
    }

    // Approved / won gate — only signed-off quotations become projects.
    if (!quotation.approved_at) {
      return NextResponse.json(
        { error: "quotation must be fully approved before it can be converted" },
        { status: 409 },
      );
    }

    const priority = PRIORITIES.includes(String(body.priority) as never)
      ? (body.priority as string)
      : "normal";
    const contactName =
      (body.contact_name?.trim() || quotation.client_name || null) ?? null;
    const contactPhones =
      (body.contact_phones?.trim() || quotation.client_phone || null) ?? null;
    const siteAddress = body.site_address?.trim() || null;
    const lat =
      typeof body.location_lat === "number" && Number.isFinite(body.location_lat)
        ? body.location_lat
        : null;
    const lng =
      typeof body.location_lng === "number" && Number.isFinite(body.location_lng)
        ? body.location_lng
        : null;
    const notes = body.notes?.trim() || null;
    const boqSnapshot = JSON.stringify(
      Array.isArray(quotation.items_json) ? quotation.items_json : [],
    );

    const inserted = (await q`
      insert into project_handoffs
        (quotation_id, project_id, folder_id, created_by, contact_name,
         contact_phones, site_address, location_lat, location_lng, priority,
         notes, boq_snapshot)
      values
        (${quotation.id}, ${quotation.project_id}, ${quotation.folder_id},
         ${user.id}, ${contactName}, ${contactPhones}, ${siteAddress},
         ${lat}, ${lng}, ${priority}, ${notes}, ${boqSnapshot}::jsonb)
      returning id
    `) as Array<{ id: number }>;

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'project_handoff', ${inserted[0].id}, 'create',
              ${JSON.stringify({ quotation_id: quotation.id, ref: quotation.ref, priority })}::jsonb)
    `;

    // Project Execution — tell the projects manager(s) a job is waiting to
    // be distributed. Fan out a TopBar notification + Web Push to every
    // projects:manager (and admins as a fallback so a fresh deployment is
    // never left without an audience). Best-effort: a notification hiccup
    // must never fail the handoff the user just created.
    try {
      const managers = (await q`
        select distinct user_id from user_module_roles
        where module = 'projects' and role = 'manager' and revoked_at is null
        union
        select id as user_id from users where role = 'admin'
      `) as Array<{ user_id: number }>;
      const recipientIds = managers
        .map((m) => m.user_id)
        .filter((uid) => uid !== user.id);
      if (recipientIds.length > 0) {
        const title = `New job for execution · ${quotation.ref}`;
        const bodyText = `${user.display_name || user.username} sent ${quotation.ref} to project execution${
          priority !== "normal" ? ` (${priority} priority)` : ""
        }. Assign a technician to start.`;
        for (const rid of recipientIds) {
          await q`
            insert into notifications (user_id, kind, title, body, link, payload)
            values (${rid}, 'project_handoff', ${title}, ${bodyText},
                    ${"/projects/handoffs"},
                    ${JSON.stringify({ handoff_id: inserted[0].id, quotation_id: quotation.id })}::jsonb)
          `;
        }
        void sendPushToUsers(recipientIds, {
          title,
          body: bodyText,
          url: "/projects/handoffs",
          tag: `handoff-${inserted[0].id}`,
        });
      }
    } catch {
      // ignore — handoff already created
    }

    return NextResponse.json({ ok: true, id: inserted[0].id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const s = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status: s });
  }
}
