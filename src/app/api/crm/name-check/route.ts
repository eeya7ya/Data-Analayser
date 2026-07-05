import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { requireCrmClientWrite } from "@/lib/modules";
import { findCrossKindConflicts, type CrmEntityKind } from "@/lib/crmNames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live de-dup check used by the "New company" / "New individual" forms.
 *   GET ?name=Foo&kind=company → { conflict: boolean, matches: [...] }
 * where `matches` are rows in the OPPOSITE list (the cross-kind block).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmClientWrite(user);

    const { searchParams } = new URL(req.url);
    const name = (searchParams.get("name") ?? "").trim();
    const kindParam = searchParams.get("kind");
    const kind: CrmEntityKind | null =
      kindParam === "company" || kindParam === "individual" ? kindParam : null;
    if (!name || !kind) {
      return NextResponse.json({ conflict: false, matches: [] });
    }

    const ownerId = canReadAll(user) ? null : user.id;
    const matches = await findCrossKindConflicts({ name, target: kind, ownerId });
    return NextResponse.json({ conflict: matches.length > 0, matches });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg, conflict: false, matches: [] }, { status });
  }
}
