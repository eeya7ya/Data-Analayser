import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/quotations/received
 *
 * The salesperson's inbox. Lists the quotations presales handed to them via
 * "Send to sales" (quotations.sent_to_sales_to = me) — the receiving side of
 * the handoff that previously surfaced nowhere. Admins see every received
 * quotation. Each row carries who sent it and whether the salesperson has
 * already filed it (`filed` = sales_accepted_at set) into a company / client /
 * project, so the queue can separate "to file" from "filed".
 */
export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    const isAdmin = canReadAll(user);

    const q = sql();
    const rows = (await q`
      select
        qt.id,
        qt.ref,
        qt.project_name,
        qt.client_name,
        qt.sent_to_sales_at,
        qt.sent_to_sales_by,
        su.display_name as sent_by_name,
        su.username     as sent_by_username
      from quotations qt
      left join users su on su.id = qt.sent_to_sales_by
      where qt.deleted_at is null
        and qt.sent_to_sales_at is not null
        -- Only quotations still awaiting action live in this inbox. Filing one
        -- (sales_accepted_at) moves it to its project's Quotations tab; junking
        -- one (rejected_at) removes it for good. Either way it leaves here, and
        -- a fresh re-send from presales (which clears both) brings it back.
        and qt.sales_accepted_at is null
        and qt.rejected_at is null
        and (${isAdmin}::boolean = true or qt.sent_to_sales_to = ${user.id})
      order by qt.sent_to_sales_at desc
      limit 200
    `) as Array<{
      id: number;
      ref: string;
      project_name: string | null;
      client_name: string | null;
      sent_to_sales_at: string | null;
      sent_to_sales_by: number | null;
      sent_by_name: string | null;
      sent_by_username: string | null;
    }>;

    const quotations = rows.map((r) => ({
      id: r.id,
      ref: r.ref,
      project_name: r.project_name,
      client_name: r.client_name,
      sent_to_sales_at: r.sent_to_sales_at,
      sent_by: r.sent_by_name || r.sent_by_username || null,
    }));

    return NextResponse.json({ quotations });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
