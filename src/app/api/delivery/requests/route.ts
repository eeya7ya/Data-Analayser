import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { hasModule } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Delivery requests (V1.8).
 *
 *   GET  /api/delivery/requests            → the delivery queue
 *   POST /api/delivery/requests            → raise a request
 *
 * Who sees what:
 *   • Delivery module (driver / manager) and admins see the whole queue —
 *     it's their work list.
 *   • Everyone else sees only the requests THEY raised (a salesperson can
 *     track the deliveries they asked for, nothing more).
 *
 * Who can raise one: any CRM (sales / presales) or projects user, plus admin —
 * "sales, and projects after a win / handoff" per the spec.
 */

const STATUSES = [
  "requested",
  "scheduled",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;
type DeliveryStatus = (typeof STATUSES)[number];

async function canRaise(userId: number, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  return (
    (await hasModule(userId, "crm")) || (await hasModule(userId, "projects"))
  );
}

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    const q = sql();
    const isAdmin = canReadAll(user);
    const isDelivery = isAdmin || (await hasModule(user.id, "delivery"));

    const rows = (await q`
      select dr.id, dr.source, dr.status, dr.priority, dr.project_id,
             dr.quotation_id, dr.lead_id, dr.client_name, dr.destination,
             dr.contact_phone, dr.notes, dr.requested_by, dr.assigned_driver_id,
             dr.scheduled_at, dr.delivered_at, dr.created_at, dr.updated_at,
             coalesce(nullif(ru.display_name, ''), ru.username) as requested_by_name,
             coalesce(nullif(du.display_name, ''), du.username) as driver_name,
             p.name  as project_name,
             qq.ref  as quotation_ref
      from delivery_requests dr
      left join users ru on ru.id = dr.requested_by
      left join users du on du.id = dr.assigned_driver_id
      left join projects p on p.id = dr.project_id
      left join quotations qq on qq.id = dr.quotation_id
      where dr.deleted_at is null
        and (${isDelivery}::boolean = true or dr.requested_by = ${user.id})
      order by
        case dr.status
          when 'requested' then 0 when 'scheduled' then 1
          when 'out_for_delivery' then 2 when 'delivered' then 3
          else 4 end,
        dr.created_at desc
      limit 500
    `) as Array<Record<string, unknown>>;

    return NextResponse.json({ requests: rows, canManage: isDelivery });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const isAdmin = canReadAll(user);
    if (!(await canRaise(user.id, isAdmin))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const body = (await req.json()) as {
      source?: string;
      priority?: string;
      project_id?: number | null;
      quotation_id?: number | null;
      lead_id?: number | null;
      client_name?: string | null;
      destination?: string | null;
      contact_phone?: string | null;
      notes?: string | null;
    };

    const source = body.source === "projects" ? "projects" : "sales";
    const priority = ["low", "normal", "high", "urgent"].includes(
      String(body.priority),
    )
      ? String(body.priority)
      : "normal";
    const clientName = body.client_name?.trim() || null;
    const destination = body.destination?.trim() || null;
    if (!clientName && !destination && !body.project_id) {
      return NextResponse.json(
        { error: "Add a client, a destination, or link a project." },
        { status: 400 },
      );
    }
    const num = (v: unknown): number | null =>
      Number.isInteger(v) && Number(v) > 0 ? Number(v) : null;

    const q = sql();
    const rows = (await q`
      insert into delivery_requests
        (source, priority, project_id, quotation_id, lead_id,
         client_name, destination, contact_phone, notes, requested_by)
      values (
        ${source}, ${priority}, ${num(body.project_id)},
        ${num(body.quotation_id)}, ${num(body.lead_id)},
        ${clientName}, ${destination}, ${body.contact_phone?.trim() || null},
        ${body.notes?.trim() || null}, ${user.id}
      )
      returning id, status, created_at
    `) as Array<{ id: number; status: DeliveryStatus; created_at: string }>;

    return NextResponse.json({ ok: true, request: rows[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
