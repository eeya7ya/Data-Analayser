import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSessionUser, canReadAll } from "@/lib/auth";
import { hasModuleRole } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight count endpoint for the TopBar approval badge.
 *
 * 1.4A — sales-only approval. Returns the number of quotations awaiting the
 * sales manager's sign-off (not approved, not rejected). Non-sales-managers
 * get zero so the badge silently stays off. `needs_presales` is retained as
 * an always-zero field for any older client still reading it.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ needs_sales: 0, needs_presales: 0, total: 0 });
  }
  await ensureSchema();

  const isAdmin = canReadAll(user);
  const isSales = isAdmin || (await hasModuleRole(user.id, "crm", "sales_manager"));

  if (!isSales) {
    return NextResponse.json({ needs_sales: 0, needs_presales: 0, total: 0 });
  }

  const q = sql();
  const counts = (await q`
    select count(*)::int as n from quotations
    where deleted_at is null
      and approved_at is null
      and rejected_at is null
  `) as Array<{ n: number }>;

  const needsSales = Number(counts[0].n);
  return NextResponse.json({
    needs_sales: needsSales,
    needs_presales: 0,
    total: needsSales,
  });
}
