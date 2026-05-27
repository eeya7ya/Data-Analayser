import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { sweepDueHolds } from "@/lib/holds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * V1.3D — sales pipeline buckets for the CRM Held / Won / Lost tabs.
 *
 *   • held — marked Held for Execution and not yet transferred (awaiting
 *            its scheduled/manual push to the projects team).
 *   • won  — client accepted, or already transferred to projects.
 *   • lost — client rejected.
 *
 * A lazy sweep runs first so any overdue holds are transferred before the
 * lists are computed — that's what makes the scheduled auto-transfer fire
 * without a cron. Non-admins see only their own quotations.
 */
interface PipelineRow {
  id: number;
  ref: string;
  project_name: string | null;
  client_name: string | null;
  folder_id: number | null;
  sales_outcome: string | null;
  sales_outcome_at: string | null;
  hold_transfer_at: string | null;
  transferred_at: string | null;
  total: string | null;
}

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireModuleAllowLegacy(user, "crm");

    const q = sql();
    // Fire the auto-transfer sweep before reading, so the Held list never
    // shows a quotation whose time has already come.
    await sweepDueHolds(q);

    const scope = canReadAll(user) ? null : user.id;

    const rows = (await q`
      select id, ref, project_name, client_name, folder_id,
             sales_outcome, sales_outcome_at, hold_transfer_at, transferred_at,
             totals_json->>'total' as total
      from quotations
      where deleted_at is null
        and (${scope}::int is null or owner_id = ${scope})
        and (
          sales_outcome in ('accepted','rejected','held')
          or transferred_at is not null
        )
      order by coalesce(sales_outcome_at, updated_at) desc
      limit 500
    `) as PipelineRow[];

    const held = rows.filter(
      (r) => r.sales_outcome === "held" && !r.transferred_at,
    );
    const won = rows.filter(
      (r) => r.sales_outcome === "accepted" || r.transferred_at,
    );
    const lost = rows.filter((r) => r.sales_outcome === "rejected");

    return NextResponse.json({
      held,
      won,
      lost,
      counts: { held: held.length, won: won.length, lost: lost.length },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
