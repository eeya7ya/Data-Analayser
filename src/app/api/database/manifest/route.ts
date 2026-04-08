import { NextResponse } from "next/server";
import { MANIFEST } from "@/lib/manifest.generated";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ manifest: MANIFEST });
  } catch {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
}
