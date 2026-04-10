import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { searchProducts, globalSearch } from "@/lib/search";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = (await req.json()) as {
      systemId?: string; // legacy — now "vendor||system"
      vendor?: string;
      system?: string;
      text?: string;
      limit?: number;
      global?: boolean;
    };

    if (body.global || (!body.systemId && !body.vendor)) {
      const hits = await globalSearch(body.text || "", body.limit || 200);
      return NextResponse.json({ mode: "global", hits });
    }

    // Parse vendor/system from the legacy systemId format or from explicit fields
    let vendor = body.vendor || "";
    let system = body.system || "";
    if (!vendor && body.systemId) {
      const parts = String(body.systemId).split("||");
      vendor = parts[0] || "";
      system = parts[1] || "";
    }

    const hits = await searchProducts({
      text: body.text,
      vendor,
      system,
      limit: body.limit,
    });

    return NextResponse.json({
      mode: "system",
      system: { vendor, system },
      hits,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "search failed" },
      { status: 500 },
    );
  }
}
