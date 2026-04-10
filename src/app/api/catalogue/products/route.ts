import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/catalogue/products?vendor=X&system=Y&q=search&limit=N&offset=M
 *
 * Query products from Supabase with optional filters and search.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    await ensureSchema();

    const sp = req.nextUrl.searchParams;
    const vendor = sp.get("vendor") || "";
    const system = sp.get("system") || "";
    const q = sp.get("q") || "";
    const limit = Math.min(Number(sp.get("limit")) || 200, 2000);
    const offset = Number(sp.get("offset")) || 0;

    const db = sql();

    // Use tagged templates for type safety — branch by which filters are set
    const pattern = q ? `%${q}%` : "";

    let products;
    let countResult;

    if (vendor && system && q) {
      products = await db`
        select * from products
        where vendor = ${vendor} and system = ${system}
          and (model ilike ${pattern} or category ilike ${pattern} or sub_category ilike ${pattern}
               or description ilike ${pattern} or fast_view ilike ${pattern})
        order by vendor, system, category, model
        limit ${limit} offset ${offset}
      `;
      countResult = await db`
        select count(*)::int as total from products
        where vendor = ${vendor} and system = ${system}
          and (model ilike ${pattern} or category ilike ${pattern} or sub_category ilike ${pattern}
               or description ilike ${pattern} or fast_view ilike ${pattern})
      `;
    } else if (vendor && system) {
      products = await db`
        select * from products
        where vendor = ${vendor} and system = ${system}
        order by vendor, system, category, model
        limit ${limit} offset ${offset}
      `;
      countResult = await db`
        select count(*)::int as total from products
        where vendor = ${vendor} and system = ${system}
      `;
    } else if (vendor && q) {
      products = await db`
        select * from products
        where vendor = ${vendor}
          and (model ilike ${pattern} or category ilike ${pattern} or sub_category ilike ${pattern}
               or description ilike ${pattern} or fast_view ilike ${pattern})
        order by vendor, system, category, model
        limit ${limit} offset ${offset}
      `;
      countResult = await db`
        select count(*)::int as total from products
        where vendor = ${vendor}
          and (model ilike ${pattern} or category ilike ${pattern} or sub_category ilike ${pattern}
               or description ilike ${pattern} or fast_view ilike ${pattern})
      `;
    } else if (vendor) {
      products = await db`
        select * from products
        where vendor = ${vendor}
        order by vendor, system, category, model
        limit ${limit} offset ${offset}
      `;
      countResult = await db`
        select count(*)::int as total from products
        where vendor = ${vendor}
      `;
    } else if (q) {
      products = await db`
        select * from products
        where model ilike ${pattern} or category ilike ${pattern} or sub_category ilike ${pattern}
              or description ilike ${pattern} or vendor ilike ${pattern} or fast_view ilike ${pattern}
        order by vendor, system, category, model
        limit ${limit} offset ${offset}
      `;
      countResult = await db`
        select count(*)::int as total from products
        where model ilike ${pattern} or category ilike ${pattern} or sub_category ilike ${pattern}
              or description ilike ${pattern} or vendor ilike ${pattern} or fast_view ilike ${pattern}
      `;
    } else {
      products = await db`
        select * from products
        order by vendor, system, category, model
        limit ${limit} offset ${offset}
      `;
      countResult = await db`
        select count(*)::int as total from products
      `;
    }

    return NextResponse.json({
      products,
      total: countResult[0]?.total || 0,
      limit,
      offset,
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    return NextResponse.json({ error: msg || "query failed" }, { status: 500 });
  }
}
