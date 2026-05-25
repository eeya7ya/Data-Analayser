import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  requireModuleAllowLegacy,
  hasModuleRole,
  type Module,
} from "@/lib/modules";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/quotations/approve
 *
 * Dual-approval workflow. A quotation needs a `sales_manager` AND a
 * `presales_manager` signoff before it becomes visible to the Projects
 * module. This endpoint stamps one side at a time; when BOTH sides are
 * stamped, `approved_at` flips to NOW() so downstream readers can use
 * a single column to filter "fully approved".
 *
 * Body: { id: number, side: 'sales' | 'presales' }
 *
 * Auth:
 *   - admin always passes
 *   - side=sales requires crm.sales_manager
 *   - side=presales requires crm.presales_manager
 *
 * Idempotent: re-approving a side already approved is a 200 with no
 * change. A quotation that was previously rejected can still be
 * re-approved here — the rejected_at stamp stays put for audit, and
 * the caller can decide whether to un-reject (Phase 5) or leave the
 * dual stamps as the historical record.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const MODULE: Module = "crm";
    await requireModuleAllowLegacy(user, MODULE);

    const body = (await req.json()) as { id?: number; side?: string };
    const id = Number(body.id);
    const side = body.side === "sales" ? "sales" : body.side === "presales" ? "presales" : null;

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    if (!side) {
      return NextResponse.json(
        { error: "side must be 'sales' or 'presales'" },
        { status: 400 },
      );
    }

    const requiredRole = side === "sales" ? "sales_manager" : "presales_manager";
    if (user.role !== "admin" && !(await hasModuleRole(user.id, MODULE, requiredRole))) {
      return NextResponse.json(
        { error: `requires crm.${requiredRole}` },
        { status: 403 },
      );
    }

    const q = sql();
    const existing = (await q`
      select id, sales_approved_at, presales_approved_at, approved_at, deleted_at
      from quotations
      where id = ${id}
    `) as Array<{
      id: number;
      sales_approved_at: string | null;
      presales_approved_at: string | null;
      approved_at: string | null;
      deleted_at: string | null;
    }>;

    if (existing.length === 0 || existing[0].deleted_at) {
      return NextResponse.json({ error: "quotation not found" }, { status: 404 });
    }
    const row = existing[0];

    // Idempotent — re-approving a side that's already stamped is a no-op.
    const alreadyApproved =
      side === "sales" ? row.sales_approved_at !== null : row.presales_approved_at !== null;
    if (alreadyApproved) {
      return NextResponse.json({
        ok: true,
        unchanged: true,
        side,
        approved_at: row.approved_at,
      });
    }

    // Stamp the requested side. We deliberately keep updated_at out of
    // this UPDATE so the quotation's last-edited timestamp continues
    // to reflect content edits, not approval clicks. If you want
    // approval-aware sorting use approved_at / sales_approved_at /
    // presales_approved_at directly.
    if (side === "sales") {
      await q`
        update quotations
        set sales_approved_by = ${user.id},
            sales_approved_at = now()
        where id = ${id}
      `;
    } else {
      await q`
        update quotations
        set presales_approved_by = ${user.id},
            presales_approved_at = now()
        where id = ${id}
      `;
    }

    // Re-read both sides and, if both are now non-null, stamp
    // approved_at. We re-read instead of trusting our local `row`
    // because the other side might have been approved concurrently
    // in another request.
    const after = (await q`
      select sales_approved_at, presales_approved_at, approved_at
      from quotations where id = ${id}
    `) as Array<{
      sales_approved_at: string | null;
      presales_approved_at: string | null;
      approved_at: string | null;
    }>;

    let bothApproved = false;
    if (
      after[0].sales_approved_at &&
      after[0].presales_approved_at &&
      !after[0].approved_at
    ) {
      await q`update quotations set approved_at = now() where id = ${id}`;
      bothApproved = true;
    } else if (after[0].approved_at) {
      bothApproved = true;
    }

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'quotation', ${id}, ${"approve_" + side},
              ${JSON.stringify({ side, fully_approved: bothApproved })}::jsonb)
    `;

    // Ping the quotation's author so they know it advanced — and on full
    // approval it's the cue for sales to proceed (PO / send BOQ).
    const ownerRows = (await q`
      select owner_id, ref from quotations where id = ${id} limit 1
    `) as Array<{ owner_id: number | null; ref: string }>;
    const ownerId = ownerRows[0]?.owner_id ?? null;
    if (ownerId) {
      void sendPushToUsers([ownerId], {
        title: bothApproved
          ? `${ownerRows[0].ref} fully approved`
          : `${ownerRows[0].ref} approved by ${side}`,
        body: bothApproved
          ? "Both sides signed off — it's ready for the next step."
          : `Waiting on the other side's sign-off.`,
        url: `/quotation?id=${id}`,
        tag: `approve-${id}`,
      });
    }

    return NextResponse.json({
      ok: true,
      side,
      fully_approved: bothApproved,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
