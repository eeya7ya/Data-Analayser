import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  requireModuleAllowLegacy,
  hasModuleRole,
} from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/quotations/reject  — body { id, reason }
 *
 * Stamps rejected_at / rejected_by / rejected_reason. A prior approval
 * stamp is LEFT IN PLACE so the audit trail of "was approved, then
 * rejected" survives — the UI can show the order by comparing timestamps.
 * Use POST /api/quotations/unreject (Phase 5) to clear rejected_at when the
 * quotation is fixed and re-submitted; for now a rejected quotation stays
 * rejected.
 *
 * 1.4A — Auth: admin OR crm.sales_manager. Presales no longer signs off on
 * quotations.
 *
 * Nothing is deleted.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireModuleAllowLegacy(user, "crm");

    const body = (await req.json()) as { id?: number; reason?: string };
    const id = Number(body.id);
    const reason = String(body.reason ?? "").trim();

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    if (reason.length === 0) {
      return NextResponse.json({ error: "reason required" }, { status: 400 });
    }
    if (reason.length > 2000) {
      return NextResponse.json(
        { error: "reason too long (max 2000 chars)" },
        { status: 400 },
      );
    }

    const isManager =
      user.role === "admin" ||
      (await hasModuleRole(user.id, "crm", "sales_manager"));

    if (!isManager) {
      return NextResponse.json(
        { error: "requires crm.sales_manager" },
        { status: 403 },
      );
    }

    const q = sql();
    const existing = (await q`
      select id, deleted_at, rejected_at from quotations where id = ${id}
    `) as Array<{ id: number; deleted_at: string | null; rejected_at: string | null }>;

    if (existing.length === 0 || existing[0].deleted_at) {
      return NextResponse.json({ error: "quotation not found" }, { status: 404 });
    }
    if (existing[0].rejected_at) {
      return NextResponse.json(
        { ok: true, unchanged: true },
        { status: 200 },
      );
    }

    await q`
      update quotations
      set rejected_at = now(),
          rejected_by = ${user.id},
          rejected_reason = ${reason}
      where id = ${id}
    `;

    await q`
      insert into syslog (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'quotation', ${id}, 'reject',
              ${JSON.stringify({ reason })}::jsonb)
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
