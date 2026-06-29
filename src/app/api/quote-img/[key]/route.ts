import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { r2PresignUrl, isR2Configured } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/quote-img/<hash>.<ext>
 *
 * Serves an offloaded quotation/catalogue image (see src/lib/imageOffload.ts).
 * The bytes live in R2 under `quote-img/<hash>.<ext>`; this presigns a
 * short-lived R2 GET and 302-redirects the browser to it, so a plain
 * `<img src="/api/quote-img/...">` renders everywhere with no client change.
 *
 * Requires a logged-in user — the session cookie is sent automatically with
 * same-origin <img> requests, so in-app rendering and print/PDF (browser-side)
 * both work.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ key: string }> },
) {
  try {
    await requireUser();
    if (!isR2Configured()) {
      return NextResponse.json({ error: "R2 not configured" }, { status: 503 });
    }
    const { key } = await ctx.params;
    // Single filename segment only — no slashes, no traversal.
    if (!key || !/^[A-Za-z0-9._-]+$/.test(key) || key.includes("..")) {
      return NextResponse.json({ error: "bad key" }, { status: 400 });
    }
    const url = r2PresignUrl("GET", `quote-img/${key}`, { expiresSeconds: 600 });
    return NextResponse.redirect(url, 302);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
