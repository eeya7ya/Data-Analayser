import { NextResponse } from "next/server";
import { SYSTEMS } from "@/lib/manifest.generated";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ systems: SYSTEMS });
  } catch {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
}
