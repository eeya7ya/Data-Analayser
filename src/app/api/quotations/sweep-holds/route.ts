import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { sweepDueHolds } from "@/lib/holds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * V1.3D — promote every Held-for-Execution quotation whose scheduled
 * transfer time has passed. Called lazily from the sales pipeline + the
 * dashboard so auto-transfer works without a cron; this endpoint exists so
 * a real scheduler (Vercel Cron, an external ping) can drive it directly
 * later without any code change.
 */
export async function POST() {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireModuleAllowLegacy(user, "crm");
    const transferred = await sweepDueHolds(sql());
    return NextResponse.json({ ok: true, transferred });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
