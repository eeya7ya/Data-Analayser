import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { hasModule, hasModuleRole } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Storage requests workflow.
 *
 *   GET    — list requests. Filterable by status, project_id, requester.
 *            Storage managers see everything; projects-module users
 *            see requests on projects they own or are assigned to,
 *            plus requests they themselves filed.
 *   POST   — any projects.* / storage.* / admin user creates a new
 *            request. status starts as 'pending'.
 *   PATCH  — storage.manager / admin flips status between pending →
 *            approved / denied / fulfilled. Soft state machine: prior
 *            status stays in activity_log; never DELETE the row.
 */

interface RequestRow {
  id: number;
  project_id: number | null;
  project_name: string | null;
  product_id: number | null;
  product_model: string | null;
  product_vendor: string | null;
  location_id: number | null;
  location_name: string | null;
  quantity: number;
  requested_by: number | null;
  requested_by_username: string | null;
  status: "pending" | "approved" | "denied" | "fulfilled";
  handled_by: number | null;
  handled_by_username: string | null;
  handled_at: string | null;
  reason: string | null;
  created_at: string;
}

const VALID_STATUSES = ["pending", "approved", "denied", "fulfilled"] as const;

async function canManage(userId: number, userRole: string): Promise<boolean> {
  if (userRole === "admin") return true;
  return hasModuleRole(userId, "storage", "manager");
}

async function canRequest(userId: number, userRole: string): Promise<boolean> {
  if (userRole === "admin") return true;
  if (await hasModule(userId, "projects")) return true;
  if (await hasModule(userId, "storage")) return true;
  return false;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    if (!(await canRequest(user.id, user.role))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const isManager = await canManage(user.id, user.role);

    const q = sql();
    // Managers see everything; everyone else sees their own requests
    // plus requests against projects they own or are assigned to. The
    // assignment check stays cheap because project_assignments is small.
    let rows: RequestRow[];
    if (isManager) {
      rows = (await q`
        select sr.id, sr.project_id, p.name as project_name,
               sr.product_id, prod.model as product_model, prod.vendor as product_vendor,
               sr.location_id, sl.name as location_name,
               sr.quantity,
               sr.requested_by, ru.username as requested_by_username,
               sr.status,
               sr.handled_by, hu.username as handled_by_username,
               sr.handled_at, sr.reason, sr.created_at
        from storage_requests sr
        left join projects p on p.id = sr.project_id
        left join products prod on prod.id = sr.product_id
        left join storage_locations sl on sl.id = sr.location_id
        left join users ru on ru.id = sr.requested_by
        left join users hu on hu.id = sr.handled_by
        where (${status ?? ""} = '' or sr.status = ${status ?? ""})
        order by sr.created_at desc
        limit 500
      `) as RequestRow[];
    } else {
      rows = (await q`
        select sr.id, sr.project_id, p.name as project_name,
               sr.product_id, prod.model as product_model, prod.vendor as product_vendor,
               sr.location_id, sl.name as location_name,
               sr.quantity,
               sr.requested_by, ru.username as requested_by_username,
               sr.status,
               sr.handled_by, hu.username as handled_by_username,
               sr.handled_at, sr.reason, sr.created_at
        from storage_requests sr
        left join projects p on p.id = sr.project_id
        left join products prod on prod.id = sr.product_id
        left join storage_locations sl on sl.id = sr.location_id
        left join users ru on ru.id = sr.requested_by
        left join users hu on hu.id = sr.handled_by
        where (${status ?? ""} = '' or sr.status = ${status ?? ""})
          and (
            sr.requested_by = ${user.id}
            or sr.project_id in (
              select id from projects where owner_id = ${user.id}
            )
            or sr.project_id in (
              select project_id from project_assignments
              where user_id = ${user.id} and deleted_at is null
            )
          )
        order by sr.created_at desc
        limit 500
      `) as RequestRow[];
    }

    return NextResponse.json({ requests: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await ensureSchema();
    if (!(await canRequest(user.id, user.role))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const body = (await req.json()) as {
      project_id?: number;
      product_id?: number;
      location_id?: number | null;
      quantity?: number;
      reason?: string;
    };

    const productId = Number(body.product_id);
    const quantity = Number(body.quantity);
    if (!Number.isInteger(productId) || productId <= 0) {
      return NextResponse.json({ error: "invalid product_id" }, { status: 400 });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return NextResponse.json(
        { error: "quantity must be a positive integer" },
        { status: 400 },
      );
    }
    const projectId =
      body.project_id !== undefined ? Number(body.project_id) : null;
    const locationId =
      body.location_id !== undefined && body.location_id !== null
        ? Number(body.location_id)
        : null;
    const reason = String(body.reason ?? "").trim() || null;

    const q = sql();
    const inserted = (await q`
      insert into storage_requests
        (project_id, product_id, location_id, quantity, requested_by, status, reason)
      values
        (${projectId}, ${productId}, ${locationId}, ${quantity}, ${user.id}, 'pending', ${reason})
      returning id
    `) as Array<{ id: number }>;

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'storage_request', ${inserted[0].id}, 'create',
              ${JSON.stringify({ project_id: projectId, product_id: productId, quantity, location_id: locationId })}::jsonb)
    `;

    return NextResponse.json({ ok: true, id: inserted[0].id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    await ensureSchema();
    if (!(await canManage(user.id, user.role))) {
      return NextResponse.json(
        { error: "requires storage.manager or admin" },
        { status: 403 },
      );
    }

    const body = (await req.json()) as {
      id?: number;
      status?: string;
      reason?: string;
    };
    const id = Number(body.id);
    const nextStatus = String(body.status ?? "");
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    if (!(VALID_STATUSES as readonly string[]).includes(nextStatus)) {
      return NextResponse.json(
        { error: `status must be one of ${VALID_STATUSES.join(", ")}` },
        { status: 400 },
      );
    }
    const reason = String(body.reason ?? "").trim() || null;

    const q = sql();
    const existing = (await q`
      select id, status from storage_requests where id = ${id}
    `) as Array<{ id: number; status: string }>;
    if (existing.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (existing[0].status === nextStatus) {
      return NextResponse.json({ ok: true, unchanged: true });
    }

    await q`
      update storage_requests
      set status = ${nextStatus},
          handled_by = ${user.id},
          handled_at = now(),
          reason = coalesce(${reason}, reason)
      where id = ${id}
    `;

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'storage_request', ${id}, ${"status_" + nextStatus},
              ${JSON.stringify({ previous_status: existing[0].status, reason })}::jsonb)
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
