#!/usr/bin/env node
/**
 * One-time seed: walk DATABASE/**.json on disk and load every product into
 * the `catalogue_items` Postgres table. Selection theory files become rows in
 * `catalogue_theory`. Nothing is dropped — every non-normalized field from
 * the source JSON is preserved verbatim in the `specs` JSONB column.
 *
 * USE THE DIRECT 5432 CONNECTION. Set POSTGRES_URL_NON_POOLING (from Supabase
 * → Project Settings → Database → Connection string → "Direct connection").
 * The Supavisor transaction pooler (port 6543) enforces a per-statement
 * timeout that will abort the large bulk upserts this script performs.
 *
 * Usage:
 *   POSTGRES_URL_NON_POOLING=postgres://... node scripts/seed-catalogue.mjs
 *
 * Idempotent — safe to re-run. Upserts on (vendor, category, model) and
 * merges specs so any manual edits made after the first seed are preserved.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import postgres from "postgres";

const ROOT = process.cwd();
const DB_DIR = join(ROOT, "DATABASE");

const url =
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;

if (!url) {
  console.error(
    "No connection string. Set POSTGRES_URL_NON_POOLING (preferred) or DATABASE_URL.",
  );
  process.exit(1);
}
if (!process.env.POSTGRES_URL_NON_POOLING) {
  console.warn(
    "⚠  POSTGRES_URL_NON_POOLING is not set — falling back to pooled URL.",
  );
  console.warn(
    "   Bulk upserts may time out on Supavisor. Use the direct 5432 URL.",
  );
}

const sql = postgres(url, {
  ssl: "require",
  prepare: false,
  max: 1,
  idle_timeout: 30,
  connect_timeout: 15,
  onnotice: () => {},
});

// ─── File walk ──────────────────────────────────────────────────────────────

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".json")) out.push(full);
  }
  return out;
}

// ─── Vendor / category extraction from folder path ──────────────────────────
// e.g. DATABASE/HIKVISION/IP Cameera/hikvision_ipc_db.json → { HIKVISION, "IP Cameera" }
function toVendorCategory(relPath) {
  const parts = relPath.split(/[\\/]/).filter(Boolean);
  parts.shift(); // drop "DATABASE"
  const vendor = parts[0] || "General";
  const category = parts.length > 2 ? parts[1] : "";
  return { vendor, category };
}

// ─── Row builder ────────────────────────────────────────────────────────────
// Normalize the small set of first-class columns and dump everything else
// into `specs`, losslessly.
const NORMALIZED_KEYS = new Set([
  "model",
  "category",
  "sub_category",
  "pricing",
]);

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildCatalogueRow(product, vendor, folderCategory, currency, sourceFile) {
  const pricing = product.pricing || {};
  const specs = {};
  for (const [k, v] of Object.entries(product)) {
    if (NORMALIZED_KEYS.has(k)) continue;
    if (k === "id") {
      specs.legacy_id = v;
      continue;
    }
    specs[k] = v;
  }
  specs.source_file = sourceFile;
  // Some vendors name the category inside the JSON (via database_info).
  // Others rely on the folder name. Prefer the product-level category, then
  // the folder category, then empty.
  const category =
    typeof product.category === "string" && product.category
      ? String(product.category)
      : folderCategory || "";
  return {
    vendor,
    category,
    sub_category:
      typeof product.sub_category === "string" ? product.sub_category : "",
    model: String(product.model ?? "").trim(),
    currency: currency || "USD",
    price_dpp: toNumberOrNull(pricing.dpp ?? pricing.price),
    price_si: toNumberOrNull(pricing.si ?? pricing.price),
    price_end_user: toNumberOrNull(pricing.end_user),
    specs,
  };
}

// ─── Seeding ────────────────────────────────────────────────────────────────

const BATCH = 200;

async function upsertCatalogueBatch(rows) {
  if (rows.length === 0) return;
  // Use the sql(array, columns) helper to send one INSERT … VALUES (...)
  // statement per batch — avoids the pooler's per-statement timeout.
  await sql`
    insert into catalogue_items ${sql(
      rows,
      "vendor",
      "category",
      "sub_category",
      "model",
      "currency",
      "price_dpp",
      "price_si",
      "price_end_user",
      "specs",
    )}
    on conflict (vendor, category, model) do update set
      sub_category   = excluded.sub_category,
      currency       = excluded.currency,
      price_dpp      = excluded.price_dpp,
      price_si       = excluded.price_si,
      price_end_user = excluded.price_end_user,
      specs          = catalogue_items.specs || excluded.specs,
      updated_at     = now()
  `;
}

async function upsertTheory(vendor, category, payload) {
  await sql`
    insert into catalogue_theory (vendor, category, payload)
    values (${vendor}, ${category}, ${sql.json(payload)})
    on conflict (vendor, category) do update set
      payload = excluded.payload,
      updated_at = now()
  `;
}

async function main() {
  console.log("→ seeding catalogue from", DB_DIR);
  const files = walk(DB_DIR);
  console.log(`  found ${files.length} JSON files`);

  // Tag the source of price changes so the trigger writes sensible history.
  await sql`select set_config('app.price_source', 'seed', false)`;

  const perVendor = new Map();
  let itemsTotal = 0;
  let theoryTotal = 0;
  let buffer = [];

  for (const absPath of files) {
    const rel = relative(ROOT, absPath).replace(/\\/g, "/");
    const { vendor, category: folderCategory } = toVendorCategory(rel);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(absPath, "utf8"));
    } catch (err) {
      console.warn(`  ⚠ skipping malformed ${rel}: ${err.message}`);
      continue;
    }

    // Selection theory lives in its own table.
    if (rel.includes("selection_theory")) {
      await upsertTheory(vendor, folderCategory, parsed);
      theoryTotal += 1;
      continue;
    }

    const currency = parsed?.database_info?.currency || "USD";
    const products = Array.isArray(parsed.products) ? parsed.products : [];
    if (products.length === 0) {
      console.log(`  (skip) ${rel} — no products[]`);
      continue;
    }

    for (const p of products) {
      const row = buildCatalogueRow(p, vendor, folderCategory, currency, rel);
      if (!row.model) continue;
      buffer.push(row);
      itemsTotal += 1;
      perVendor.set(vendor, (perVendor.get(vendor) || 0) + 1);
      if (buffer.length >= BATCH) {
        await upsertCatalogueBatch(buffer);
        buffer = [];
      }
    }
  }
  if (buffer.length) await upsertCatalogueBatch(buffer);

  console.log(
    `✓ seeded ${itemsTotal} catalogue_items and ${theoryTotal} theory rows`,
  );
  console.log("  per-vendor counts:");
  for (const [v, c] of [...perVendor.entries()].sort()) {
    console.log(`    ${v.padEnd(24)}  ${c}`);
  }
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (err) => {
    console.error(err);
    try {
      await sql.end({ timeout: 5 });
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
