import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { hasModuleRole, requireModuleAllowLegacy } from "@/lib/modules";
import { transferHeldQuotation } from "@/lib/holds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * V1.3D — manually transfer a Held-for-Execution quotation to the
 * projects team right now, instead of waiting for its scheduled time (or
 * when no schedule was set). Creates the project handoff and stamps
 * `transferred_at`; the projects manager then assigns a member.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireModuleAllowLegacy(user, "crm");

    const isAdmin = canReadAll(user);
    const canTransfer =
      isAdmin ||
      (await hasModuleRole(user.id, "crm", "sales")) ||
      (await hasModuleRole(user.id, "crm", "sales_manager"));
    if (!canTransfer) {
      return NextResponse.json(
        { error: "only sales users can transfer a held quotation" },
        { status: 403 },
      );
    }

    const body = (await req.json()) as { id?: number };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }

    const q = sql();
    const rows = (await q`
      select owner_id, sales_outcome, transferred_at, approved_at,
             sent_to_sales_to, sales_accepted_by
      from quotations
      where id = ${id} and deleted_at is null
      limit 1
    `) as Array<{
      owner_id: number | null;
      sales_outcome: string | null;
      transferred_at: string | null;
      approved_at: string | null;
      sent_to_sales_to: number | null;
      sales_accepted_by: number | null;
    }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const quotation = rows[0];

    const isSalesManager =
      isAdmin || (await hasModuleRole(user.id, "crm", "sales_manager"));
    // The recipient salesperson (sent_to_sales_to / whoever filed it) drives
    // the deal to execution just like the owner — mirrors /api/quotations/outcome.
    const isRecipient =
      quotation.sent_to_sales_to === user.id ||
      quotation.sales_accepted_by === user.id;
    if (!isAdmin && !isSalesManager && !isRecipient && quotation.owner_id !== user.id) {
      return NextResponse.json(
        { error: "you can only transfer quotations sent to you or owned by you" },
        { status: 403 },
      );
    }
    if (quotation.sales_outcome !== "held") {
      return NextResponse.json(
        { error: "mark the quotation Held for Execution first" },
        { status: 409 },
      );
    }
    if (quotation.transferred_at) {
      return NextResponse.json(
        { error: "already transferred to the projects team" },
        { status: 409 },
      );
    }
    if (!quotation.approved_at) {
      return NextResponse.json(
        { error: "the quotation must be approved before transfer" },
        { status: 409 },
      );
    }

    const handoffId = await transferHeldQuotation(q, id, user.id);
    if (!handoffId) {
      return NextResponse.json(
        { error: "could not transfer this quotation" },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, handoff_id: handoffId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
