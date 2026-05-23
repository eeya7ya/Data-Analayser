export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";

/** List every soft-deleted pricing manufacturer and project. Admin only. */
export async function GET() {
  try {
    const user = await requireAdmin();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();

    const q = sql();
    const mfgs = (await q`
      select id, name, color, tag, created_by_user_id, created_at, deleted_at
      from pricing_manufacturers
      where deleted_at is not null
      order by deleted_at desc
    `) as Array<Record<string, unknown>>;
    const projects = (await q`
      select p.id, p.name, p.date, p.responsible_person, p.manufacturer_id,
             p.user_id, p.parent_project_id, p.revision_number,
             p.created_at, p.deleted_at,
             m.name as manufacturer_name
      from pricing_projects p
      left join pricing_manufacturers m on m.id = p.manufacturer_id
      where p.deleted_at is not null
      order by p.deleted_at desc
    `) as Array<Record<string, unknown>>;
    return NextResponse.json({ manufacturers: mfgs, projects });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
