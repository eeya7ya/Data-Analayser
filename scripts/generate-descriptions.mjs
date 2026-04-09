#!/usr/bin/env node
/**
 * Batch-generate professional product descriptions for every row in
 * `catalogue_items` where `description = ''` (or all rows with `--force`).
 *
 * Sends 8 products per Groq request against `llama-3.1-8b-instant`. With
 * ~1000 products that's ~125 requests — well under the free tier's 30 RPM
 * limit, completing in roughly 4–5 minutes.
 *
 * Usage:
 *   GROQ_API_KEY=... DATABASE_URL=... node scripts/generate-descriptions.mjs
 *   # options:
 *   #   --force              regenerate even rows with description_locked=true
 *   #   --vendor=HIKVISION   limit to a single vendor
 *   #   --limit=50           process at most N rows
 *   #   --batch=8            override batch size
 */
import postgres from "postgres";
import Groq from "groq-sdk";

// ─── Arg parsing ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function flag(name) {
  return args.includes(`--${name}`);
}
function opt(name, fallback) {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split("=").slice(1).join("=") : fallback;
}

const FORCE = flag("force");
const VENDOR = opt("vendor", null);
const LIMIT = Number(opt("limit", 0)) || 0;
const BATCH = Number(opt("batch", 8)) || 8;
const MODEL = process.env.GROQ_DESCRIPTION_MODEL || "llama-3.1-8b-instant";

// ─── Env + clients ──────────────────────────────────────────────────────────

const dbUrl =
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;
if (!dbUrl) {
  console.error("No connection string. Set DATABASE_URL or POSTGRES_URL_NON_POOLING.");
  process.exit(1);
}
if (!process.env.GROQ_API_KEY) {
  console.error("GROQ_API_KEY missing. Grab a free key at https://console.groq.com/keys");
  process.exit(1);
}

const sql = postgres(dbUrl, {
  ssl: "require",
  prepare: false,
  max: 1,
  idle_timeout: 30,
  connect_timeout: 15,
  onnotice: () => {},
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── Spec serializer (copy of src/lib/descriptions.ts:serializeSpecsForLLM) ─

const SKIP_KEYS = new Set([
  "id",
  "model",
  "category",
  "sub_category",
  "pricing",
  "series",
  "vendor",
  "brand",
  "legacy_id",
  "source_file",
  "description",
]);

function formatLeaf(v) {
  if (v === null || v === undefined || v === "" || v === false) return null;
  if (v === true) return "Yes";
  if (typeof v === "number" || typeof v === "string") return String(v);
  return null;
}

function serializeSpecsForLLM(specs) {
  const parts = [];
  function walk(key, value) {
    if (value === null || value === undefined || value === "" || value === false) return;
    const label = key.replace(/_/g, " ");
    if (Array.isArray(value)) {
      const items = value
        .map((v) => (typeof v === "object" && v !== null ? null : formatLeaf(v)))
        .filter((x) => !!x);
      if (items.length) parts.push(`${label}: ${items.join(", ")}`);
      return;
    }
    if (typeof value === "object") {
      for (const [nk, nv] of Object.entries(value)) walk(nk, nv);
      return;
    }
    const formatted = formatLeaf(value);
    if (formatted) parts.push(`${label}: ${formatted}`);
  }
  for (const [k, v] of Object.entries(specs || {})) {
    if (SKIP_KEYS.has(k)) continue;
    walk(k, v);
  }
  return parts.join(" • ");
}

// ─── Groq prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are MagicTech's senior product copywriter for a
professional low-current / ICT / AV / surveillance catalogue. For each
product given, write a formal product description (2–4 sentences,
80–140 words) suitable for a formal sales quotation.

Requirements:
- State clearly what the product is, its primary purpose, and the series it belongs to if present.
- Incorporate CONCRETE technical capabilities from the provided specs — list
  actual numbers (resolution, ports, power, range, dimensions, supported codecs, etc.).
- Include typical use cases / application environments when they are obvious from the specs.
- Formal, precise technical English. No marketing fluff, no exclamation marks, no vendor slogans.
- NEVER invent specs that are not in the input. If a field is absent, do not mention it.
- Output STRICT JSON only — no prose, no markdown fences.

Return exactly:
{ "items": [ { "id": <number>, "description": "<string>" }, ... ] }`;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function generateBatch(rows) {
  const payload = rows.map((r) => ({
    id: r.id,
    vendor: r.vendor,
    category: r.category,
    sub_category: r.sub_category || undefined,
    model: r.model,
    specs: serializeSpecsForLLM(r.specs),
  }));
  const user = `Write a description for each of the following products.\n\nPRODUCTS:\n${JSON.stringify(payload, null, 2)}`;

  let attempt = 0;
  while (true) {
    try {
      const res = await groq.chat.completions.create({
        model: MODEL,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
      });
      const text = res.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(text);
      return (parsed.items || []).filter(
        (x) => typeof x.id === "number" && typeof x.description === "string",
      );
    } catch (err) {
      if (err?.status === 429 && attempt < 4) {
        const retryAfter = Number(err?.headers?.["retry-after"]) || 0;
        const wait = retryAfter ? retryAfter * 1000 : 1000 * Math.pow(2, attempt);
        attempt += 1;
        console.warn(`  429 — waiting ${wait}ms (retry ${attempt}/4)`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Using model: ${MODEL}`);
  console.log(`Batch size: ${BATCH}${FORCE ? " (force mode)" : ""}${VENDOR ? ` vendor=${VENDOR}` : ""}${LIMIT ? ` limit=${LIMIT}` : ""}`);

  // Pull the target rows. Use sql fragments for dynamic predicates.
  const filterVendor = VENDOR ? sql`and vendor = ${VENDOR}` : sql``;
  const filterMissing = FORCE
    ? sql``
    : sql`and (description = '' or description_locked = false)`;
  const limitClause = LIMIT ? sql`limit ${LIMIT}` : sql``;

  const rows = await sql`
    select id, vendor, category, sub_category, model, currency, price_dpp, price_si, specs
    from catalogue_items
    where active = true
      ${filterVendor}
      ${filterMissing}
    order by id
    ${limitClause}
  `;

  console.log(`→ ${rows.length} rows to process`);
  if (rows.length === 0) return;

  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      const results = await generateBatch(batch);
      const byId = new Map(results.map((r) => [r.id, r.description]));
      // Write back in a single round trip via IDs
      for (const row of batch) {
        const desc = byId.get(row.id);
        if (!desc) continue;
        await sql`
          update catalogue_items
             set description = ${desc}
           where id = ${row.id}
        `;
      }
      done += batch.length;
      console.log(`  ${done}/${rows.length} done`);
    } catch (err) {
      console.error(`  batch starting at id ${batch[0].id} failed:`, err.message);
    }
  }
  console.log(`✓ processed ${done} rows`);
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (err) => {
    console.error(err);
    try {
      await sql.end({ timeout: 5 });
    } catch {}
    process.exit(1);
  });
