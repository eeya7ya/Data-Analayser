/**
 * AI-generated professional product descriptions.
 *
 * The catalogue used to lean on `flatSpecs()` in `CatalogBrowser.tsx` to build
 * descriptions at render time. Those read like raw spec dumps. This module
 * generates real, formal sales copy from the full spec payload using Groq
 * (free-tier `llama-3.1-8b-instant` — descriptions are a high-volume, simple
 * task where 8B gives ~5x the throughput of the 70B design model).
 *
 * Batching is critical: 8 products per Groq request cuts request count ~10x,
 * keeping us well under the free tier's 30 RPM limit even for a full backfill
 * of ~1000 items.
 */

import Groq from "groq-sdk";
import { groqClient } from "./groq";

const DESC_MODEL =
  process.env.GROQ_DESCRIPTION_MODEL || "llama-3.1-8b-instant";

// ─── Public shape ───────────────────────────────────────────────────────────

export interface CatalogueRowForLLM {
  id: number;
  vendor: string;
  category: string;
  sub_category?: string | null;
  model: string;
  currency: string;
  price_dpp: number | null;
  price_si: number | null;
  specs: Record<string, unknown>;
}

export interface GeneratedDescription {
  id: number;
  description: string;
}

// ─── Spec serializer (extracted from CatalogBrowser.tsx:32 flatSpecs) ───────

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

function formatLeaf(v: unknown): string | null {
  if (v === null || v === undefined || v === "" || v === false) return null;
  if (v === true) return "Yes";
  if (typeof v === "number" || typeof v === "string") return String(v);
  return null;
}

/**
 * Flatten the spec payload into a "label: value • label: value" string
 * suitable for feeding to the LLM (or as a render-time fallback when
 * `description` is empty). Nested objects are walked; arrays become
 * comma-joined leaf lists.
 */
export function serializeSpecsForLLM(
  specs: Record<string, unknown>,
): string {
  const parts: string[] = [];

  function walk(key: string, value: unknown): void {
    if (value === null || value === undefined || value === "" || value === false)
      return;
    const label = key.replace(/_/g, " ");
    if (Array.isArray(value)) {
      const items = value
        .map((v) => (typeof v === "object" && v !== null ? null : formatLeaf(v)))
        .filter((x): x is string => !!x);
      if (items.length) parts.push(`${label}: ${items.join(", ")}`);
      return;
    }
    if (typeof value === "object") {
      for (const [nk, nv] of Object.entries(value as Record<string, unknown>)) {
        walk(nk, nv);
      }
      return;
    }
    const formatted = formatLeaf(value);
    if (formatted) parts.push(`${label}: ${formatted}`);
  }

  for (const [k, v] of Object.entries(specs)) {
    if (SKIP_KEYS.has(k)) continue;
    walk(k, v);
  }
  return parts.join(" • ");
}

// ─── Prompt ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are MagicTech's senior product copywriter for a
professional low-current / ICT / AV / surveillance catalogue. For each
product given, write a formal product description (2–4 sentences,
80–140 words) suitable for a formal sales quotation.

Requirements:
- State clearly what the product is, its primary purpose, and the series it belongs to if present.
- Incorporate CONCRETE technical capabilities from the provided specs — list
  actual numbers (resolution, ports, power, range, dimensions, supported codecs, etc.).
- Include typical use cases / application environments when they are obvious
  from the specs.
- Formal, precise technical English. No marketing fluff, no exclamation marks,
  no vendor slogans.
- NEVER invent specs that are not in the input. If a field is absent, do not
  mention it.
- Output STRICT JSON only — no prose, no markdown fences.

Return exactly:
{ "items": [ { "id": <number>, "description": "<string>" }, ... ] }`;

function buildUserPrompt(items: CatalogueRowForLLM[]): string {
  const payload = items.map((it) => ({
    id: it.id,
    vendor: it.vendor,
    category: it.category,
    sub_category: it.sub_category || undefined,
    model: it.model,
    specs: serializeSpecsForLLM(it.specs),
  }));
  return `Write a description for each of the following products. Return the
JSON object described in the system prompt.

PRODUCTS:
${JSON.stringify(payload, null, 2)}`;
}

// ─── 429 backoff helper ────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GroqErrorLike {
  status?: number;
  headers?: Record<string, string>;
}

function parseRetryAfterMs(err: unknown): number {
  const e = err as GroqErrorLike;
  const raw = e?.headers?.["retry-after"] ?? e?.headers?.["Retry-After"];
  if (raw) {
    const sec = Number(raw);
    if (Number.isFinite(sec)) return Math.max(1000, sec * 1000);
  }
  return 0;
}

// ─── Main entry point ──────────────────────────────────────────────────────

/**
 * Generate professional descriptions for a batch of catalogue rows. Sends all
 * rows in one Groq request (recommended batch size: 5–10). Returns one entry
 * per input row, preserving ids.
 */
export async function generateDescriptionsBatch(
  items: CatalogueRowForLLM[],
  opts: { client?: Groq; maxRetries?: number } = {},
): Promise<GeneratedDescription[]> {
  if (items.length === 0) return [];
  const client = opts.client || groqClient();
  const maxRetries = opts.maxRetries ?? 4;

  let attempt = 0;
  while (true) {
    try {
      const res = await client.chat.completions.create({
        model: DESC_MODEL,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(items) },
        ],
      });
      const text = res.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(text) as {
        items?: Array<{ id?: number; description?: string }>;
      };
      const out: GeneratedDescription[] = [];
      for (const row of parsed.items || []) {
        if (typeof row.id !== "number" || typeof row.description !== "string")
          continue;
        out.push({
          id: row.id,
          description: row.description.trim(),
        });
      }
      return out;
    } catch (err) {
      const e = err as GroqErrorLike;
      if (e?.status === 429 && attempt < maxRetries) {
        const wait = parseRetryAfterMs(err) || 1000 * Math.pow(2, attempt);
        attempt += 1;
        console.warn(
          `Groq 429 — backing off ${wait}ms (attempt ${attempt}/${maxRetries})`,
        );
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
}

export const DESCRIPTION_MODEL = DESC_MODEL;
export const DESCRIPTION_BATCH_SIZE = 8;
