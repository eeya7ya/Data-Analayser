import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  findSystem,
  loadSystem,
  searchProducts,
  globalSearch,
} from "@/lib/search";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = (await req.json()) as {
      systemId?: number | string;
      text?: string;
      filters?: Record<string, string | number | boolean>;
      limit?: number;
      global?: boolean;
    };

    if (body.global || !body.systemId) {
      const hits = await globalSearch(body.text || "", body.limit || 12);
      return NextResponse.json({ mode: "global", hits });
    }

    const system = findSystem(body.systemId);
    if (!system) {
      return NextResponse.json({ error: "System not found" }, { status: 404 });
    }

    const { db, theory } = await loadSystem(system);
    const hits = searchProducts(db, {
      text: body.text,
      filters: body.filters,
      limit: body.limit,
    });

    return NextResponse.json({
      mode: "system",
      system,
      theorySummary:
        theory && typeof theory === "object"
          ? (theory as Record<string, unknown>).database_info
          : null,
      hits,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "search failed" },
      { status: 500 },
    );
  }
}
