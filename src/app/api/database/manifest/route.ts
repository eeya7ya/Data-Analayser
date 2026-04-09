import { NextResponse } from "next/server";
import { loadManifest } from "@/lib/search";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser();
    const manifest = await loadManifest();
    return NextResponse.json({ manifest });
  } catch {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
}
