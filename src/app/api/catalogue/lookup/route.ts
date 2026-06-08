import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

/**
 * POST /api/catalogue/lookup
 *
 * Body: { models: string[] }
 * Returns: { products: Record<string, ProductRow> }
 *
 * Bulk model→product details lookup used by the Technical Proposal view
 * to enrich each Bill of Materials row with the catalogue's full
 * description, fast_view headline, specifications and picture_url —
 * without having to issue one HTTP call per row. Case-insensitive
 * exact-model match; first row wins when two vendors share a model.
 */

interface ProductRow {
  id: number;
  vendor: string;
  system: string;
  category: string;
  sub_category: string;
  fast_view: string;
  model: string;
  description: string;
  specifications: string;
  picture_url: string | null;
}

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    await ensureSchema();
    const body = (await req.json().catch(() => ({}))) as { models?: unknown };
    const rawModels = Array.isArray(body.models) ? body.models : [];
    const models = Array.from(
      new Set(
        rawModels
          .map((m) => String(m || "").trim())
          .filter((m) => m.length > 0 && m.length < 200),
      ),
    ).slice(0, 500);

    if (models.length === 0) {
      return NextResponse.json({ products: {} });
    }

    const db = sql();
    // Case-insensitive exact match on model. The unique key in practice is
    // (vendor, model) but the quotation only carries `model`, so we collapse
    // duplicates client-side by taking the first hit per lowercased model.
    const rows = (await db`
      select id, vendor, system, category, sub_category, fast_view,
             model, description, specifications, picture_url
      from products
      where lower(model) = any(${models.map((m) => m.toLowerCase())}::text[])
    `) as ProductRow[];

    const byModel: Record<string, ProductRow> = {};
    for (const r of rows) {
      const key = (r.model || "").toLowerCase();
      if (key && !byModel[key]) byModel[key] = r;
    }

    return NextResponse.json({ products: byModel });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
