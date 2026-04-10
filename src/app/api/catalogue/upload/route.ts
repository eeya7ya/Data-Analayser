import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

interface UploadRow {
  vendor: string;
  system: string;
  category: string;
  sub_category: string;
  fast_view: string;
  model: string;
  description: string;
  currency: string;
  price_si: number;
  specifications: string;
}

/**
 * POST /api/catalogue/upload
 * Body: { rows: UploadRow[] }
 *
 * Upserts parsed Excel rows into the products table.
 * Requires admin auth.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    await ensureSchema();

    const body = (await req.json()) as { rows?: UploadRow[] };
    const rows = body.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: "No rows provided" },
        { status: 400 },
      );
    }

    // Validate and sanitize rows
    const clean = rows.map((r) => ({
      vendor: String(r.vendor || "").trim(),
      system: String(r.system || "").trim(),
      category: String(r.category || "").trim(),
      sub_category: String(r.sub_category || "").trim(),
      fast_view: String(r.fast_view || "").trim(),
      model: String(r.model || "").trim(),
      description: String(r.description || "").trim(),
      currency: String(r.currency || "USD").trim(),
      price_si: typeof r.price_si === "number" ? r.price_si : parseFloat(String(r.price_si)) || 0,
      specifications: String(r.specifications || "").trim(),
    }));

    // Filter out rows without a model
    const valid = clean.filter((r) => r.model && r.vendor);
    if (valid.length === 0) {
      return NextResponse.json(
        { error: "No valid rows (every row needs at least vendor and model)" },
        { status: 400 },
      );
    }

    const q = sql();
    let upserted = 0;

    // Upsert in batches of 50
    for (let i = 0; i < valid.length; i += 50) {
      const batch = valid.slice(i, i + 50);
      await q`
        insert into products ${q(
          batch,
          "vendor",
          "system",
          "category",
          "sub_category",
          "fast_view",
          "model",
          "description",
          "currency",
          "price_si",
          "specifications",
        )}
        on conflict (vendor, model) do update set
          system         = excluded.system,
          category       = excluded.category,
          sub_category   = excluded.sub_category,
          fast_view      = excluded.fast_view,
          description    = excluded.description,
          currency       = excluded.currency,
          price_si       = excluded.price_si,
          specifications = excluded.specifications,
          updated_at     = now()
      `;
      upserted += batch.length;
    }

    return NextResponse.json({ ok: true, upserted });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    return NextResponse.json({ error: msg || "upload failed" }, { status: 500 });
  }
}
