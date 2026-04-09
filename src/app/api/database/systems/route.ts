import { NextResponse } from "next/server";
import { loadSystems } from "@/lib/search";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser();
    const systems = await loadSystems();
    return NextResponse.json({ systems });
  } catch {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
}
