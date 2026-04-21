import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireUser } from "@/lib/auth";
import { getAppSettings, saveAppSettings, type AppSettings } from "@/lib/settings";

export const runtime = "nodejs";

/**
 * GET /api/settings
 *
 * Returns the current global presets (default terms, footer text). Any
 * authenticated user can read — the Designer and QuotationViewer both need
 * this to seed new quotations and render the footer.
 */
export async function GET() {
  try {
    await requireUser();
    const settings = await getAppSettings();
    return NextResponse.json({ settings });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}

/**
 * PATCH /api/settings
 *
 * Admin-only. Accepts a partial AppSettings object and merges it into the
 * single global row.
 */
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json()) as Partial<AppSettings>;
    const patch: Partial<AppSettings> = {};
    if (Array.isArray(body.defaultTerms)) {
      patch.defaultTerms = body.defaultTerms
        .map((t) => String(t ?? "").trim())
        .filter((t) => t.length > 0);
    }
    if (typeof body.footerText === "string") {
      patch.footerText = body.footerText;
    }
    const settings = await saveAppSettings(patch);
    return NextResponse.json({ settings });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      {
        status:
          msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500,
      },
    );
  }
}
