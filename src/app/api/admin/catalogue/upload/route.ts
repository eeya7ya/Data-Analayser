/**
 * Excel bulk upload for the catalogue.
 *
 *   POST /api/admin/catalogue/upload             — dry-run preview (default)
 *   POST /api/admin/catalogue/upload?commit=1    — apply the changes
 *
 * Multipart body with a single `file` field containing an .xlsx workbook.
 * The App Router handles multipart natively via `req.formData()` — no
 * formidable / multer.
 *
 * Expected columns (headers, case-insensitive):
 *   vendor | category | sub_category | model | description | currency
 *   price_dpp | price_si | price_end_user | spec_<any>...
 *
 * Any column prefixed `spec_` is merged into the `specs` JSONB.
 *
 * The commit path runs a single `sql.begin(async sql => { ... })` transaction
 * (mandatory under Supavisor), sets `app.price_source = 'excel'` so the
 * price-history trigger writes the correct source, then upserts in batches
 * of 200 rows via the `sql(rows, 'col1', 'col2', ...)` helper.
 */
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdmin } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import { invalidateSystemsCache } from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ParsedRow {
  vendor: string;
  category: string;
  sub_category: string;
  model: string;
  description: string;
  currency: string;
  price_dpp: number | null;
  price_si: number | null;
  price_end_user: number | null;
  specs: Record<string, unknown>;
  _errors: string[];
  _rowNumber: number;
}

interface ExistingRow {
  id: number;
  vendor: string;
  category: string;
  model: string;
  price_dpp: string | number | null;
  price_si: string | number | null;
  price_end_user: string | number | null;
}

type DiffKind = "insert" | "update" | "unchanged" | "invalid";

interface RowDiff {
  rowNumber: number;
  vendor: string;
  category: string;
  model: string;
  kind: DiffKind;
  errors?: string[];
  oldPriceSi?: number | null;
  newPriceSi?: number | null;
  oldPriceDpp?: number | null;
  newPriceDpp?: number | null;
  oldPriceEndUser?: number | null;
  newPriceEndUser?: number | null;
  priceChangePct?: number | null;
}

function errResponse(err: unknown) {
  const msg = (err as Error).message || "error";
  const status =
    msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
  return NextResponse.json({ error: msg }, { status });
}

function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normalizeHeader(s: unknown): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function parseWorkbook(buf: Buffer): ParsedRow[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: true,
  });
  const out: ParsedRow[] = [];
  raw.forEach((r, i) => {
    const errors: string[] = [];
    const rec: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      rec[normalizeHeader(k)] = v;
    }
    const vendor = String(rec.vendor || "").trim();
    const model = String(rec.model || "").trim();
    if (!vendor) errors.push("vendor is required");
    if (!model) errors.push("model is required");

    const specs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (!k.startsWith("spec_")) continue;
      const key = k.slice(5);
      if (v === "" || v === null || v === undefined) continue;
      specs[key] = v;
    }

    out.push({
      vendor,
      category: String(rec.category || "").trim(),
      sub_category: String(rec.sub_category || "").trim(),
      model,
      description: String(rec.description || "").trim(),
      currency: String(rec.currency || "USD").trim() || "USD",
      price_dpp: toNumOrNull(rec.price_dpp),
      price_si: toNumOrNull(rec.price_si),
      price_end_user: toNumOrNull(rec.price_end_user),
      specs,
      _errors: errors,
      _rowNumber: i + 2, // header is row 1
    });
  });
  return out;
}

function priceChanged(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return false;
  if (a == null || b == null) return true;
  return Math.abs(a - b) > 0.0001;
}

function toNum(x: string | number | null): number | null {
  if (x == null) return null;
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    await ensureSchema();

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing `file` field (multipart/form-data)." },
        { status: 400 },
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const rows = parseWorkbook(buf);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Workbook is empty or has no readable rows." },
        { status: 400 },
      );
    }

    const { searchParams } = new URL(req.url);
    const commit = searchParams.get("commit") === "1";

    const db = sql();

    // Pull existing rows matching any (vendor, category, model) triple in the upload.
    const keys = rows
      .filter((r) => r._errors.length === 0)
      .map((r) => ({
        vendor: r.vendor,
        category: r.category,
        model: r.model,
      }));

    const existingMap = new Map<string, ExistingRow>();
    if (keys.length > 0) {
      // Build an IN list via VALUES clause; for up to a few thousand rows this
      // is reliable and fits inside the statement-size limit.
      const vendors = [...new Set(keys.map((k) => k.vendor))];
      const existing = (await db`
        select id, vendor, category, model, price_dpp, price_si, price_end_user
          from catalogue_items
         where vendor in ${db(vendors)}
      `) as ExistingRow[];
      for (const row of existing) {
        existingMap.set(`${row.vendor}::${row.category}::${row.model}`, row);
      }
    }

    const diffs: RowDiff[] = [];
    let inserts = 0;
    let updates = 0;
    let unchanged = 0;
    let invalid = 0;

    for (const r of rows) {
      if (r._errors.length > 0) {
        invalid += 1;
        diffs.push({
          rowNumber: r._rowNumber,
          vendor: r.vendor,
          category: r.category,
          model: r.model,
          kind: "invalid",
          errors: r._errors,
        });
        continue;
      }
      const key = `${r.vendor}::${r.category}::${r.model}`;
      const existing = existingMap.get(key);
      if (!existing) {
        inserts += 1;
        diffs.push({
          rowNumber: r._rowNumber,
          vendor: r.vendor,
          category: r.category,
          model: r.model,
          kind: "insert",
          newPriceDpp: r.price_dpp,
          newPriceSi: r.price_si,
          newPriceEndUser: r.price_end_user,
        });
        continue;
      }
      const oldDpp = toNum(existing.price_dpp);
      const oldSi = toNum(existing.price_si);
      const oldEnd = toNum(existing.price_end_user);
      const changed =
        priceChanged(oldDpp, r.price_dpp) ||
        priceChanged(oldSi, r.price_si) ||
        priceChanged(oldEnd, r.price_end_user);
      if (changed) {
        updates += 1;
        const pct =
          oldSi && r.price_si
            ? ((r.price_si - oldSi) / oldSi) * 100
            : null;
        diffs.push({
          rowNumber: r._rowNumber,
          vendor: r.vendor,
          category: r.category,
          model: r.model,
          kind: "update",
          oldPriceDpp: oldDpp,
          newPriceDpp: r.price_dpp,
          oldPriceSi: oldSi,
          newPriceSi: r.price_si,
          oldPriceEndUser: oldEnd,
          newPriceEndUser: r.price_end_user,
          priceChangePct: pct,
        });
      } else {
        unchanged += 1;
        diffs.push({
          rowNumber: r._rowNumber,
          vendor: r.vendor,
          category: r.category,
          model: r.model,
          kind: "unchanged",
        });
      }
    }

    const summary = {
      total: rows.length,
      inserts,
      updates,
      unchanged,
      invalid,
    };

    if (!commit) {
      return NextResponse.json({
        mode: "dry-run",
        summary,
        diffs,
      });
    }

    // ─── Commit path ─────────────────────────────────────────────────────
    const valid = rows.filter((r) => r._errors.length === 0);
    const BATCH = 200;
    await db.begin(async (tx) => {
      await tx`select set_config('app.price_source', 'excel', true)`;
      for (let i = 0; i < valid.length; i += BATCH) {
        // postgres.js auto-serialises plain JS objects to jsonb on insert,
        // so we pass `specs` as-is and let the driver handle the encoding.
        const slice = valid.slice(i, i + BATCH).map((r) => ({
          vendor: r.vendor,
          category: r.category,
          sub_category: r.sub_category,
          model: r.model,
          description: r.description,
          currency: r.currency,
          price_dpp: r.price_dpp,
          price_si: r.price_si,
          price_end_user: r.price_end_user,
          specs: r.specs as unknown as string,
        }));
        await tx`
          insert into catalogue_items ${tx(
            slice,
            "vendor",
            "category",
            "sub_category",
            "model",
            "description",
            "currency",
            "price_dpp",
            "price_si",
            "price_end_user",
            "specs",
          )}
          on conflict (vendor, category, model) do update set
            sub_category   = excluded.sub_category,
            description    = case when excluded.description <> '' then excluded.description else catalogue_items.description end,
            description_locked = case when excluded.description <> '' then true else catalogue_items.description_locked end,
            currency       = excluded.currency,
            price_dpp      = excluded.price_dpp,
            price_si       = excluded.price_si,
            price_end_user = excluded.price_end_user,
            specs          = catalogue_items.specs || excluded.specs,
            active         = true,
            updated_at     = now()
        `;
      }
    });

    invalidateSystemsCache();

    return NextResponse.json({
      mode: "commit",
      summary,
      diffs,
    });
  } catch (err) {
    return errResponse(err);
  }
}
