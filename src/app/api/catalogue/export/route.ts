import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/catalogue/export
 *
 * Dumps the entire `products` table as a plain JSON array. The client
 * (`CatalogueExportButton` in the Catalogue page) turns the rows into a
 * `.xlsx` workbook with the same column layout that
 * `/api/catalogue/upload` accepts, so the round-trip
 *
 *   download → edit in Excel → upload
 *
 * is lossless: a re-uploaded file upserts each row by `model` and updates
 * the existing record in place.
 *
 * Admin-only: the download exposes full supplier pricing which isn't
 * intended for regular users.
 */
export async function GET() {
  try {
    await requireAdmin();
    await ensureSchema();
    const q = sql();
    // picture_url comes back as a data URL (base64) for in-database
    // pictures, or a hosted URL when the picture lives in object
    // storage. The client decides whether to embed the image in the
    // exported workbook (default) or skip pictures for a lightweight
    // text-only export.
    const rows = (await q`
      select vendor, system, category, sub_category, fast_view, model,
             description, currency, price_si, specifications, picture_url
      from products
      order by vendor, system, category, model
    `) as Array<Record<string, unknown>>;
    return NextResponse.json({ products: rows });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    return NextResponse.json({ error: msg || "export failed" }, { status: 500 });
  }
}
