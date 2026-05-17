import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leads/users?role=presales|sales|projects
 *
 * Helper for the lead workflow dropdowns:
 *   ?role=presales  → users holding crm.presales or crm.presales_manager
 *   ?role=sales     → users holding crm.sales or crm.sales_manager
 *   ?role=projects  → users holding any projects role (technical/engineer/manager)
 *
 * Always includes admin users so an empty-team deployment still has
 * somebody to pick. Returns { id, username, display_name }.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const role = searchParams.get("role");

    const q = sql();
    let rows: Array<{ id: number; username: string; display_name: string }> = [];

    if (role === "presales") {
      rows = (await q`
        select distinct u.id, u.username, u.display_name
        from users u
        left join user_module_roles r on r.user_id = u.id and r.revoked_at is null
        where u.role = 'admin'
           or (r.module = 'crm' and r.role in ('presales','presales_manager'))
        order by u.display_name nulls last, u.username
      `) as typeof rows;
    } else if (role === "sales") {
      rows = (await q`
        select distinct u.id, u.username, u.display_name
        from users u
        left join user_module_roles r on r.user_id = u.id and r.revoked_at is null
        where u.role = 'admin'
           or (r.module = 'crm' and r.role in ('sales','sales_manager'))
        order by u.display_name nulls last, u.username
      `) as typeof rows;
    } else if (role === "projects") {
      rows = (await q`
        select distinct u.id, u.username, u.display_name
        from users u
        left join user_module_roles r on r.user_id = u.id and r.revoked_at is null
        where u.role = 'admin'
           or (r.module = 'projects' and r.role in ('technical','engineer','manager'))
        order by u.display_name nulls last, u.username
      `) as typeof rows;
    } else {
      return NextResponse.json(
        { error: "role must be presales, sales, or projects" },
        { status: 400 },
      );
    }

    return NextResponse.json({ users: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
