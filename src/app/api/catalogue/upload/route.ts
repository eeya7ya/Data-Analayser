import { NextRequest, NextResponse } from "next/server";
import type { Sql } from "postgres";
import { requireUser } from "@/lib/auth";
import { requireModule } from "@/lib/modules";
import { sql, ensureSchema, usingD1, rawBinder } from "@/lib/db";
import { invalidateSystemsCache } from "@/lib/search";

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
  picture_url?: string | null;
}

/**
 * Mirrors the per-row PATCH endpoint's guard: only accept image data URLs
 * and only up to ~280 KB (200 KB compressed payload + base64 overhead).
 * Anything else is dropped silently so the row still upserts.
 */
const PICTURE_MAX_LENGTH = 280_000;
function sanitizePictureUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  if (!s.startsWith("data:image/")) return null;
  if (s.length > PICTURE_MAX_LENGTH) return null;
  return s;
}

/**
 * Ensure `products` has the UNIQUE(model) index that `ON CONFLICT (model)`
 * depends on, cleaning up any pre-existing duplicate-model rows first.
 *
 * Only runs on D1: Postgres declares the constraint in the schema bootstrap, so
 * there's nothing to heal there. On D1 the SQLite schema port originally omitted
 * the constraint; a self-heal at boot (`ensureD1UniqueIndexes`) adds it, but it
 * silently gives up when the table already contains duplicate models — which is
 * precisely the state a broken upload leaves behind. Without the index,
 * `ON CONFLICT (model)` errors on SQLite, so we resolve it here at upload time:
 * collapse duplicates (keep the newest row per model) then create the index.
 *
 * Returns the number of duplicate rows removed (0 when the index already
 * existed, i.e. the common warm path — a single cheap SELECT).
 */
async function ensureModelUpsertTarget(q: Sql, d1: boolean): Promise<number> {
  if (!d1) return 0;

  const existing = (await q.unsafe(
    `select name from sqlite_master where type = 'index' and name = 'products_model_key'`,
  )) as Array<Record<string, unknown>>;
  if (existing.length > 0) return 0; // already enforced → no duplicates possible

  // Count the duplicate rows we're about to drop, for user-facing feedback.
  const before = (await q.unsafe(`select count(*) as c from products`)) as Array<{
    c: number | string;
  }>;
  const totalBefore = Number(before[0]?.c ?? 0);

  // Keep the highest id (most recently inserted) per model; delete the rest.
  await q.unsafe(
    `delete from products
       where id not in (select max(id) from products group by model)`,
  );

  const after = (await q.unsafe(`select count(*) as c from products`)) as Array<{
    c: number | string;
  }>;
  const totalAfter = Number(after[0]?.c ?? 0);

  await q.unsafe(
    `create unique index if not exists "products_model_key" on "products" ("model")`,
  );

  return Math.max(0, totalBefore - totalAfter);
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
    // Catalogue Modifier write: admins and storage-module users (the page is
    // gated to the same set).
    await requireModule(await requireUser(), "storage");
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
      picture_url: sanitizePictureUrl(r.picture_url),
    }));

    // Filter out rows without a model
    const validAll = clean.filter((r) => r.model && r.vendor);
    if (validAll.length === 0) {
      return NextResponse.json(
        { error: "No valid rows (every row needs at least vendor and model)" },
        { status: 400 },
      );
    }

    // Deduplicate by model — keep last occurrence so later rows in the
    // spreadsheet win. This prevents "ON CONFLICT DO UPDATE command
    // cannot affect row a second time" when the same model appears twice.
    const seen = new Map<string, number>();
    for (let i = 0; i < validAll.length; i++) {
      seen.set(validAll[i].model, i);
    }
    const valid = [...seen.values()].sort((a, b) => a - b).map((i) => validAll[i]);

    const q = sql();
    const d1 = usingD1();

    // Make sure the model-keyed upsert target exists before we rely on
    // `ON CONFLICT (model)`. On D1 (SQLite) the schema port originally shipped
    // `products` without its UNIQUE(model) constraint, and earlier uploads that
    // silently failed to upsert may have left duplicate-model rows behind —
    // which is exactly the "it duplicates existing items" symptom, and which
    // also blocks the unique index from being created. Collapse any existing
    // duplicates (keep the newest row per model) and add the index so every
    // re-import updates in place from here on.
    const existingDupesRemoved = await ensureModelUpsertTarget(q, d1);

    let upserted = 0;
    const inFileDupes = validAll.length - valid.length;

    // Upsert via raw parameterized SQL rather than the `postgres` library's
    // `q(rows, ...cols)` multi-row helper: under the D1 client that helper's
    // tagged template returns a Promise (not a composable SQL fragment), so it
    // produced invalid SQL and the upsert never ran — leaving the catalogue to
    // accumulate duplicates instead of updating. `rawBinder()` emits `?` for
    // D1 and `$n` for Postgres, so this one code path works on both backends.
    //
    // Chunk size is capped at 9 rows because each row binds 11 parameters and
    // D1 rejects statements with more than ~100 bound parameters. Picture-heavy
    // rows are additionally capped by cumulative byte size so a batch of large
    // embedded thumbnails stays well within D1's per-query limits.
    const MAX_ROWS_PER_STMT = 9;
    const MAX_BYTES_PER_STMT = 800_000;

    const chunks: (typeof valid)[] = [];
    let cur: typeof valid = [];
    let curBytes = 0;
    for (const r of valid) {
      const rBytes = (r.picture_url?.length ?? 0) + 256;
      if (
        cur.length > 0 &&
        (cur.length >= MAX_ROWS_PER_STMT || curBytes + rBytes > MAX_BYTES_PER_STMT)
      ) {
        chunks.push(cur);
        cur = [];
        curBytes = 0;
      }
      cur.push(r);
      curBytes += rBytes;
    }
    if (cur.length > 0) chunks.push(cur);

    for (const batch of chunks) {
      const { P, params } = rawBinder();
      const tuples = batch
        .map(
          (r) =>
            `(${P(r.vendor)}, ${P(r.system)}, ${P(r.category)}, ` +
            `${P(r.sub_category)}, ${P(r.fast_view)}, ${P(r.model)}, ` +
            `${P(r.description)}, ${P(r.currency)}, ${P(r.price_si)}, ` +
            `${P(r.specifications)}, ${P(r.picture_url)}, now(), now())`,
        )
        .join(", ");
      await q.unsafe(
        `insert into products
           (vendor, system, category, sub_category, fast_view, model,
            description, currency, price_si, specifications, picture_url,
            created_at, updated_at)
         values ${tuples}
         on conflict (model) do update set
           vendor         = excluded.vendor,
           system         = excluded.system,
           category       = excluded.category,
           sub_category   = excluded.sub_category,
           fast_view      = excluded.fast_view,
           description    = excluded.description,
           currency       = excluded.currency,
           price_si       = excluded.price_si,
           specifications = excluded.specifications,
           picture_url    = coalesce(excluded.picture_url, products.picture_url),
           updated_at     = now()`,
        params,
      );
      upserted += batch.length;
    }

    // The catalogue changed → drop the cached vendor/system list.
    invalidateSystemsCache();
    return NextResponse.json({
      ok: true,
      upserted,
      // Duplicate rows the caller no longer sees: same-model rows collapsed
      // within the uploaded file plus any pre-existing duplicate rows cleaned
      // out of the catalogue on the way in.
      duplicatesRemoved: inFileDupes + existingDupesRemoved,
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    return NextResponse.json({ error: msg || "upload failed" }, { status: 500 });
  }
}
