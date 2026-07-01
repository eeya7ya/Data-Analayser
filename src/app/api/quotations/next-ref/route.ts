import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { sql, ensureSchema, usingD1 } from "@/lib/db";
import { d1Query } from "@/lib/db-d1";
import { genActiveRef } from "@/lib/quotationRef";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/quotations/next-ref
 *
 * The actual next auto-generated quotation reference for the current user
 * (e.g. "ITYA-FO26-0001"), computed read-only with the same genActiveRef the
 * create handler uses — so the Designer previews the real number, not a bare
 * "(auto)". Idempotent: the counter isn't consumed until a quotation is saved.
 */
export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();

    const useD1 = usingD1();
    let deptCode = "";
    if (useD1) {
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

    // The actual next reference (e.g. "ITYA-FO26-0001"), computed read-only via
    // the same generator the create handler uses — not just the prefix.
    const ref = await genActiveRef(
      useD1,
      useD1 ? null : sql(),
      deptCode,
      user.username,
    );
    return NextResponse.json({ ref });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
