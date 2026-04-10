import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listSystems } from "@/lib/search";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUser();
    const systems = await listSystems();
    return NextResponse.json({ systems });
  } catch {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
}
