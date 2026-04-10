#!/usr/bin/env node
/**
 * One-time migration: reads every DATABASE/**\/*_db.json file and upserts
 * the products into the Supabase `products` table.
 *
 * Usage:
 *   DATABASE_URL=postgres://… node scripts/migrate-json-to-db.mjs
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING;
if (!url) {
  console.error("No Supabase connection string found. Set DATABASE_URL.");
  process.exit(1);
}

const sql = postgres(url, {
  ssl: "require",
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

const DB_ROOT = path.resolve(import.meta.dirname || ".", "../DATABASE");

/** Recursively find all *_db.json files. */
function findDbFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findDbFiles(full));
    } else if (entry.name.endsWith("_db.json")) {
      results.push(full);
    }
  }
  return results;
}

/** Flatten a nested object into a readable one-line spec string. */
function flattenSpecs(obj, depth = 0) {
  if (depth > 3 || obj == null) return [];
  const parts = [];
  if (typeof obj !== "object") return [String(obj)];
  if (Array.isArray(obj)) {
    return obj.map((v) =>
      typeof v === "object" ? flattenSpecs(v, depth + 1).join(", ") : String(v),
    ).filter(Boolean);
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    const label = k.replace(/_/g, " ");
    if (typeof v === "boolean") {
      if (v) parts.push(label);
    } else if (typeof v === "number" || typeof v === "string") {
      parts.push(`${label}: ${v}`);
    } else if (Array.isArray(v)) {
      const items = v
        .map((x) => (typeof x === "object" ? null : String(x)))
        .filter(Boolean);
      if (items.length) parts.push(`${label}: ${items.join(", ")}`);
    } else if (typeof v === "object") {
      const nested = flattenSpecs(v, depth + 1);
      if (nested.length) parts.push(`${label}: ${nested.join(", ")}`);
    }
  }
  return parts;
}

/** Build a fast_view summary from key product fields. */
function buildFastView(product) {
  const parts = [];
  if (product.sub_category) parts.push(String(product.sub_category));
  else if (product.category) parts.push(String(product.category));

  // Pick a few standout spec values if available.
  const specs = product.specs || {};
  const highlights = [];
  if (specs.resolution) highlights.push(String(specs.resolution));
  if (specs.ports) highlights.push(`${specs.ports} ports`);
  if (specs.poe === true) highlights.push("PoE");
  if (product.rated_power_w) highlights.push(`${product.rated_power_w}W`);
  if (specs.screen_size_inch || specs.screen)
    highlights.push(String(specs.screen_size_inch || specs.screen));
  if (highlights.length) parts.push(highlights.join(", "));
  return parts.join(" | ").slice(0, 500);
}

/** Extract SI price from pricing object. Handles number and string range. */
function extractSiPrice(pricing) {
  if (!pricing) return 0;
  // Try si first, then silver_partner, then dpp.
  for (const key of ["si", "silver_partner", "dpp", "price", "retail"]) {
    const v = pricing[key];
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      // Handle range like "55-57" → take lower bound.
      const m = v.match(/[\d.]+/);
      if (m) return parseFloat(m[0]);
    }
  }
  return 0;
}

/** Get a clean vendor name from manufacturer string. */
function cleanVendor(manufacturer) {
  if (!manufacturer) return "";
  // Strip parenthetical legal names: "DSPPA (Guangzhou...)" → "DSPPA"
  return manufacturer.replace(/\s*\(.*\)/, "").trim();
}

async function main() {
  const files = findDbFiles(DB_ROOT);
  console.log(`Found ${files.length} _db.json files.`);

  let total = 0;

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf-8");
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      console.warn(`  Skipping (invalid JSON): ${file}`);
      continue;
    }

    const info = data.database_info || {};
    const products = data.products || [];
    if (products.length === 0) continue;

    const vendor =
      cleanVendor(info.manufacturer) ||
      path.basename(path.dirname(file)).replace(/\s+/g, " ");
    const system = info.category || "";
    const currency = info.currency || "USD";

    console.log(
      `  ${path.relative(DB_ROOT, file)} → ${vendor} | ${system} (${products.length} products)`,
    );

    const rows = products.map((p) => {
      // Collect all spec-like data: explicit specs + top-level extra fields.
      const skip = new Set([
        "id",
        "model",
        "category",
        "sub_category",
        "pricing",
        "series",
        "status",
        "features",
      ]);
      const extraSpecs = {};
      for (const [k, v] of Object.entries(p)) {
        if (
          !skip.has(k) &&
          typeof v !== "undefined" &&
          v !== null &&
          typeof v !== "string" &&
          typeof v !== "number"
        ) {
          // Skip primitives that are already in dedicated columns.
        } else if (!skip.has(k) && !["category", "sub_category", "model", "id"].includes(k)) {
          if (typeof v === "object") extraSpecs[k] = v;
        }
      }
      const specsObj = { ...(p.specs || {}), ...extraSpecs };
      const specsFlat = flattenSpecs(specsObj);
      const features = Array.isArray(p.features) ? p.features : [];
      const allSpecParts = [...specsFlat, ...features];

      return {
        vendor,
        system,
        category: String(p.category || ""),
        sub_category: String(p.sub_category || ""),
        fast_view: buildFastView(p),
        model: String(p.model || `unknown-${p.id || Math.random()}`),
        description: allSpecParts.join("  |  ").slice(0, 2000),
        currency,
        price_si: extractSiPrice(p.pricing),
        specifications: JSON.stringify(specsObj).slice(0, 10000),
      };
    });

    // Upsert in batches of 50.
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      await sql`
        insert into products ${sql(
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
          updated_at     = now()
      `;
      total += batch.length;
    }
  }

  console.log(`\nDone — upserted ${total} products into Supabase.`);
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
