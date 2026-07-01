import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { sql, ensureSchema, usingD1 } from "@/lib/db";
import { d1Query } from "@/lib/db-d1";
import { quotationRefPrefix } from "@/lib/quotationRef";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/quotations/next-ref
 *
 * The PREFIX of the auto-generated quotation reference for the current user:
 * `<DEPT>-FO<YY>-` (e.g. "ITD1-FO26-"), mirroring genActiveRef in the POST
 * handler. The 4-hex counter is assigned server-side on save (scoped per
 * department + year), so the Designer can preview the real format as
 * "<prefix>####" instead of a bare "(auto)". Read-only.
 */
export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();

    let deptCode = "";
    if (usingD1()) {
      const r = await d1Query<{ department_code: string }>(
        `select coalesce(department_code,'') as department_code from users where id = ?`,
        [user.id],
      );
      deptCode = r.results[0]?.department_code || "";
    } else {
      const r = (await sql()`
        select coalesce(department_code,'') as department_code
        from users where id = ${user.id}
      `) as Array<{ department_code: string }>;
      deptCode = r[0]?.department_code || "";
    }

    // Mirrors genActiveRef: <DEPT+initials>-FO<YY>-, e.g. "ITYA-FO26-".
    return NextResponse.json({
      prefix: quotationRefPrefix(deptCode, user.username),
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
