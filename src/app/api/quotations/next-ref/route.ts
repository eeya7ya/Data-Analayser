import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { sql, ensureSchema, usingD1 } from "@/lib/db";
import { d1Query } from "@/lib/db-d1";
import {
  quotationRefPrefix,
  hex4,
  nextRefCounter,
} from "@/lib/quotationRef";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/quotations/next-ref
 *
 * The next auto-generated quotation reference for the current user, e.g.
 * "ITYA-FO26-0001". Mirrors genActiveRef in the POST handler exactly (same
 * prefix + same lowest-free counter over all live refs), so the Designer can
 * preview the REAL number that will be minted on save instead of a bare
 * "(auto)" or an "####" placeholder. The authoritative number is still
 * assigned server-side on save (this preview can go stale if someone else
 * claims the same counter first). Read-only.
 */
export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();

    let deptCode = "";
    let refRows: Array<{ ref: string }>;
    if (usingD1()) {
      const r = await d1Query<{ department_code: string }>(
        `select coalesce(department_code,'') as department_code from users where id = ?`,
        [user.id],
      );
      deptCode = r.results[0]?.department_code || "";
      const refs = await d1Query<{ ref: string }>(
        `select ref from quotations where deleted_at is null`,
      );
      refRows = refs.results;
    } else {
      const q = sql();
      const r = (await q`
        select coalesce(department_code,'') as department_code
        from users where id = ${user.id}
      `) as Array<{ department_code: string }>;
      deptCode = r[0]?.department_code || "";
      // Every live ref — soft-deleted rows free their counter for reuse, so
      // they're excluded (matches genActiveRef).
      refRows = (await q`
        select ref from quotations where deleted_at is null
      `) as Array<{ ref: string }>;
    }

    // Mirrors genActiveRef: <DEPT+initials>-FO<YY>-<HEX4>, e.g. "ITYA-FO26-0001".
    const prefix = quotationRefPrefix(deptCode, user.username);
    const next = hex4(nextRefCounter(refRows.map((r) => r.ref), prefix));
    return NextResponse.json({ prefix, next, ref: `${prefix}${next}` });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
