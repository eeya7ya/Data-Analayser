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
        qt.sales_accepted_at,
        qt.rejected_at,
        qt.rejected_reason,
        qt.company_id,
        qt.folder_id,
        qt.project_id,
        su.display_name as sent_by_name,
        su.username     as sent_by_username,
        fo.name         as folder_name,
        pr.name         as project_filed_name
      from quotations qt
      left join users su on su.id = qt.sent_to_sales_by
      left join client_folders fo on fo.id = qt.folder_id
      left join projects pr on pr.id = qt.project_id
      where qt.deleted_at is null
        and qt.sent_to_sales_at is not null
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
      sales_accepted_at: string | null;
      rejected_at: string | null;
      rejected_reason: string | null;
      company_id: number | null;
      folder_id: number | null;
      project_id: number | null;
      sent_by_name: string | null;
      sent_by_username: string | null;
      folder_name: string | null;
      project_filed_name: string | null;
    }>;

    const quotations = rows.map((r) => ({
      id: r.id,
      ref: r.ref,
      project_name: r.project_name,
      client_name: r.client_name,
      sent_to_sales_at: r.sent_to_sales_at,
      sent_by: r.sent_by_name || r.sent_by_username || null,
      // Filed once the salesperson has run the Company → Client → Project
      // filing on it (which stamps sales_accepted_at).
      filed: !!r.sales_accepted_at,
      // Junked (dismissed) by the salesperson — kept visible in its own group
      // rather than silently hidden.
      junked: !!r.rejected_at,
      junk_reason: r.rejected_reason,
      folder_id: r.folder_id,
      project_id: r.project_id,
      folder_name: r.folder_name,
      project_filed_name: r.project_filed_name,
    }));

    return NextResponse.json({ quotations });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
