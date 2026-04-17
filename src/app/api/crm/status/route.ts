import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";

export const runtime = "nodejs";

/**
 * Lightweight endpoint the TopBar polls so the CRM nav links can be revealed
 * (or hidden) without requiring every page that renders TopBar to pre-fetch
 * AppSettings. Returns { enabled: false } for anonymous callers so login pages
 * never surface CRM nav.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ enabled: false });
  try {
    const settings = await getAppSettings();
    return NextResponse.json({
      enabled: !!settings.crmModuleEnabled,
      isAdmin: user.role === "admin",
    });
  } catch {
    return NextResponse.json({ enabled: false });
  }
}
