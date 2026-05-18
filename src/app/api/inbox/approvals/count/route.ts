import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSessionUser, canReadAll } from "@/lib/auth";
import { hasModuleRole } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight count endpoint for the TopBar approval badge.
 *
 * Returns the number of quotations waiting on this user's signoff,
 * split by side. Sales-only managers see needs_sales; presales-only
 * see needs_presales; admins / both-side managers see both. A 200 is
 * always returned — non-managers just get zeros so the badge silently
 * stays off rather than the TopBar fetch erroring loudly.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ needs_sales: 0, needs_presales: 0, total: 0 });
  }
  await ensureSchema();

  const isAdmin = canReadAll(user);
  const isSales = isAdmin || (await hasModuleRole(user.id, "crm", "sales_manager"));
  const isPresales =
    isAdmin || (await hasModuleRole(user.id, "crm", "presales_manager"));

  if (!isSales && !isPresales) {
    return NextResponse.json({ needs_sales: 0, needs_presales: 0, total: 0 });
  }

  const q = sql();
  const counts = (await q`
    select
      (case when ${isSales}
            then (select count(*) from quotations
                  where deleted_at is null
                    and sales_approved_at is null
                    and rejected_at is null
                    and approved_at is null)
            else 0 end) as needs_sales,
      (case when ${isPresales}
            then (select count(*) from quotations
                  where deleted_at is null
                    and presales_approved_at is null
                    and rejected_at is null
                    and approved_at is null)
            else 0 end) as needs_presales
  `) as Array<{ needs_sales: number; needs_presales: number }>;

  const needsSales = Number(counts[0].needs_sales);
  const needsPresales = Number(counts[0].needs_presales);
  return NextResponse.json({
    needs_sales: needsSales,
    needs_presales: needsPresales,
    total: needsSales + needsPresales,
  });
}
