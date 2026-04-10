import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/catalogue/systems
 *
 * Returns unique vendor+system pairs with product counts and currency.
 */
export async function GET() {
  try {
    await requireUser();
    await ensureSchema();

    const q = sql();
    const rows = await q`
      select
        vendor,
        system,
        currency,
        count(*)::int as product_count
      from products
      group by vendor, system, currency
      order by vendor, system
    `;

    return NextResponse.json({ systems: rows });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    return NextResponse.json({ error: msg || "query failed" }, { status: 500 });
  }
}
