export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";

type Ctx = { params: Promise<{ id: string }> };

/** Restore a soft-deleted project. Admin only. */
export async function PUT(_req: Request, { params }: Ctx) {
  try {
    const user = await requireAdmin();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const { id } = await params;
    const q = sql();
    const rows = (await q`
      update pricing_projects
      set deleted_at = null
      where id = ${parseInt(id, 10)}
      returning id, name, manufacturer_id, user_id
    `) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/** Permanently delete a soft-deleted project (cascades to constants/lines). */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireAdmin();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const { id } = await params;
    const q = sql();
    await q`delete from pricing_projects where id = ${parseInt(id, 10)}`;
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
