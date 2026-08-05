import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { requireCatalogueWrite } from "@/lib/modules";
import { sql, ensureSchema } from "@/lib/db";
import { fingerprintRow } from "@/lib/catalogueFingerprint";

export const runtime = "nodejs";

/**
 * GET /api/catalogue/fingerprints
 *
 * Returns a compact change-detection map of the whole catalogue so the Excel
 * re-import can skip rows that haven't changed instead of re-uploading every
 * product. For each model:
 *
 *   { [model]: { t: <data-field fingerprint>, p: 0 | 1 (has a picture) } }
 *
 * The picture itself is never returned — it's large and re-compresses on every
 * round-trip, so it isn't part of the fingerprint (see catalogueFingerprint.ts).
 * `p` only tells the client whether a picture already exists, so it can treat a
 * newly-added picture as a change.
 *
 * Same auth as the upload it pairs with (anyone who may modify the catalogue:
 * admins, `catalogue.editor` grant holders, storage-module users).
 */
export async function GET() {
  try {
    await requireCatalogueWrite(await requireUser());
    await ensureSchema();

    const q = sql();
    // Only the data fields (no picture_url blob) so the result stays small and
    // well under D1's per-query result cap even for a large catalogue.
    const rows = (await q`
      select vendor, system, category, sub_category, fast_view, model,
             description, currency, price_si, specifications,
             case when picture_url is null or picture_url = '' then 0 else 1 end as has_pic
      from products
    `) as Array<Record<string, unknown>>;

    const fingerprints: Record<string, { t: string; p: 0 | 1 }> = {};
    for (const r of rows) {
      const model = String(r.model ?? "").trim();
      if (!model) continue;
      fingerprints[model] = {
        t: fingerprintRow({
          vendor: String(r.vendor ?? ""),
          system: String(r.system ?? ""),
          category: String(r.category ?? ""),
          sub_category: String(r.sub_category ?? ""),
          fast_view: String(r.fast_view ?? ""),
          description: String(r.description ?? ""),
          currency: String(r.currency ?? ""),
          price_si: typeof r.price_si === "number" ? r.price_si : String(r.price_si ?? ""),
          specifications: String(r.specifications ?? ""),
        }),
        p: Number(r.has_pic) ? 1 : 0,
      };
    }

    return NextResponse.json({ fingerprints, count: rows.length });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    return NextResponse.json({ error: msg || "fingerprints failed" }, { status: 500 });
  }
}
