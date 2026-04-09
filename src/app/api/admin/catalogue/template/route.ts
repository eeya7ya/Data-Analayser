/**
 * GET /api/admin/catalogue/template
 *
 * Streams a generated .xlsx template with the expected column layout and
 * one example row per vendor (pulled from the live catalogue). Admin-only.
 */
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdmin } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_COLUMNS = [
  "vendor",
  "category",
  "sub_category",
  "model",
  "description",
  "currency",
  "price_dpp",
  "price_si",
  "price_end_user",
];

interface SampleRow {
  vendor: string;
  category: string;
  sub_category: string | null;
  model: string;
  description: string;
  currency: string;
  price_dpp: number | string | null;
  price_si: number | string | null;
  price_end_user: number | string | null;
  specs: Record<string, unknown> | null;
}

export async function GET() {
  try {
    await requireAdmin();
    await ensureSchema();
    const db = sql();

    // One example row per vendor (lexicographically lowest model per vendor).
    const rows = (await db`
      select distinct on (vendor)
             vendor, category, sub_category, model, description, currency,
             price_dpp, price_si, price_end_user, specs
        from catalogue_items
       where active = true
       order by vendor, model
    `) as SampleRow[];

    // Gather union of spec keys for the header row.
    const specKeys = new Set<string>();
    for (const r of rows) {
      for (const k of Object.keys(r.specs || {})) {
        if (k === "source_file" || k === "legacy_id") continue;
        if (typeof (r.specs as Record<string, unknown>)[k] === "object") continue;
        specKeys.add(k);
      }
    }
    const specCols = [...specKeys].sort().map((k) => `spec_${k}`);
    const header = [...BASE_COLUMNS, ...specCols];

    const samples = rows.map((r) => {
      const out: Record<string, unknown> = {
        vendor: r.vendor,
        category: r.category,
        sub_category: r.sub_category || "",
        model: r.model,
        description: r.description,
        currency: r.currency,
        price_dpp: r.price_dpp ?? "",
        price_si: r.price_si ?? "",
        price_end_user: r.price_end_user ?? "",
      };
      for (const k of specKeys) {
        const v = (r.specs || {})[k];
        out[`spec_${k}`] =
          v === null || v === undefined || typeof v === "object" ? "" : v;
      }
      return out;
    });

    // Fallback: if the catalogue is empty, still emit a usable template.
    const sheetRows =
      samples.length > 0
        ? samples
        : [
            {
              vendor: "HIKVISION",
              category: "IP Camera",
              sub_category: "Bullet",
              model: "DS-2CD1021G0-I 2.8MM",
              description: "",
              currency: "USD",
              price_dpp: 18,
              price_si: 20,
              price_end_user: 25,
              spec_resolution: "2MP",
              spec_ir_range_m: 30,
              spec_lens_mm: 2.8,
            },
          ];

    const ws = XLSX.utils.json_to_sheet(sheetRows, { header });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "catalogue");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          'attachment; filename="catalogue_template.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = (err as Error).message || "error";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
