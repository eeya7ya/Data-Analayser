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
 * POST /api/quotations/approve  — body { id: number }
 *
 * 1.4A — sales-only approval. Presales does not sign off on quotations;
 * their job is designing and following up on sales requests. A quotation is
 * approved when a `sales_manager` (or admin) signs off: this stamps
 * `sales_approved_at` AND `approved_at` together, so downstream readers keep
 * using the single `approved_at` column to filter "approved".
 *
 * Idempotent: approving an already-approved quotation is a 200 no-op. A
 * previously rejected quotation can still be approved — the rejected_at
 * stamp stays for audit.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const MODULE: Module = "crm";
    await requireModuleAllowLegacy(user, MODULE);

    const body = (await req.json()) as { id?: number };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    if (user.role !== "admin" && !(await hasModuleRole(user.id, MODULE, "sales_manager"))) {
      return NextResponse.json(
        { error: "requires crm.sales_manager" },
        { status: 403 },
      );
    }

    const q = sql();
    const existing = (await q`
      select id, sales_approved_at, approved_at, deleted_at
      from quotations
      where id = ${id}
    `) as Array<{
      id: number;
      sales_approved_at: string | null;
      approved_at: string | null;
      deleted_at: string | null;
    }>;

    if (existing.length === 0 || existing[0].deleted_at) {
      return NextResponse.json({ error: "quotation not found" }, { status: 404 });
    }
    const row = existing[0];

    // Idempotent — already approved is a no-op.
    if (row.approved_at) {
      return NextResponse.json({
        ok: true,
        unchanged: true,
        approved_at: row.approved_at,
      });
    }

    // Sales sign-off is the sole gate: stamp both columns at once. We keep
    // updated_at out of this UPDATE so the quotation's last-edited timestamp
    // reflects content edits, not approval clicks.
    await q`
      update quotations
      set sales_approved_by = ${user.id},
          sales_approved_at = now(),
          approved_at = now()
      where id = ${id}
    `;

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'quotation', ${id}, 'approve_sales',
              ${JSON.stringify({ fully_approved: true })}::jsonb)
    `;

    // Ping the quotation's author — approval is the cue for sales to proceed
    // (PO / send BOQ).
    const ownerRows = (await q`
      select owner_id, ref from quotations where id = ${id} limit 1
    `) as Array<{ owner_id: number | null; ref: string }>;
    const ownerId = ownerRows[0]?.owner_id ?? null;
    if (ownerId) {
      void sendPushToUsers([ownerId], {
        title: `${ownerRows[0].ref} approved`,
        body: "Signed off — it's ready for the next step.",
        url: `/quotation?id=${id}`,
        tag: `approve-${id}`,
      });
    }

    return NextResponse.json({ ok: true, fully_approved: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
