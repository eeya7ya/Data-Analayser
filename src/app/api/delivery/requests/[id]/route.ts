import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { hasModule } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/delivery/requests/[id]
 *
 * Progress a delivery request or assign a driver. Restricted to the delivery
 * module (driver / manager) and admins — the people who actually run
 * deliveries. Body accepts any of:
 *   { status: "scheduled" | "out_for_delivery" | "delivered" | "cancelled" }
 *   { assigned_driver_id: number | null }
 *   { scheduled_at: ISO | null }
 * `scheduled_at` / `delivered_at` are stamped automatically on the matching
 * status so the timeline is trustworthy without extra client bookkeeping.
 */

const STATUSES = [
  "requested",
  "scheduled",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const isAdmin = canReadAll(user);
    if (!isAdmin && !(await hasModule(user.id, "delivery"))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const { id: idParam } = await ctx.params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    const body = (await req.json()) as {
      status?: string;
      assigned_driver_id?: number | null;
      scheduled_at?: string | null;
    };

    const q = sql();
    const exists = (await q`
      select id from delivery_requests where id = ${id} and deleted_at is null limit 1
    `) as Array<{ id: number }>;
    if (exists.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    let didSomething = false;

    if (typeof body.status === "string") {
      if (!(STATUSES as readonly string[]).includes(body.status)) {
        return NextResponse.json({ error: "invalid status" }, { status: 400 });
      }
      const status = body.status;
      // Stamp the matching timestamp; clearing a status back also clears it so
      // the record never claims a delivery time it didn't reach.
      await q`
        update delivery_requests set
          status = ${status},
          scheduled_at = case
            when ${status} in ('scheduled','out_for_delivery','delivered')
              then coalesce(scheduled_at, now()) else scheduled_at end,
          delivered_at = case
            when ${status} = 'delivered' then coalesce(delivered_at, now())
            else null end,
          updated_at = now()
        where id = ${id}
      `;
      didSomething = true;
    }

    if ("assigned_driver_id" in body) {
      const driverId =
        Number.isInteger(body.assigned_driver_id) &&
        Number(body.assigned_driver_id) > 0
          ? Number(body.assigned_driver_id)
          : null;
      await q`
        update delivery_requests
        set assigned_driver_id = ${driverId}, updated_at = now()
        where id = ${id}
      `;
      didSomething = true;
    }

    if (!didSomething) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
