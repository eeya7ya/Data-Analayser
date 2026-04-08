import Groq from "groq-sdk";

export function groqClient(): Groq {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error(
      "GROQ_API_KEY is missing. Get a free key at https://console.groq.com/keys",
    );
  }
  return new Groq({ apiKey: key });
}

/** All chat/text-generation models available on this Groq account. */
export const GROQ_CHAT_MODELS = [
  {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B Versatile",
    description: "Balanced quality & speed — default design model",
    supportsJsonMode: true,
  },
  {
    id: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B Instant",
    description: "Fastest, lightest — good for simple BoQ tasks",
    supportsJsonMode: true,
  },
  {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
    label: "Llama 4 Scout 17B",
    description: "Llama 4 multimodal scout model",
    supportsJsonMode: true,
  },
  {
    id: "moonshotai/kimi-k2-instruct",
    label: "Kimi K2",
    description: "Moonshot AI — strong reasoning & long context",
    supportsJsonMode: false,
  },
  {
    id: "moonshotai/kimi-k2-instruct-0905",
    label: "Kimi K2 (Sep-05)",
    description: "Moonshot AI — September checkpoint",
    supportsJsonMode: false,
  },
  {
    id: "openai/gpt-oss-120b",
    label: "GPT OSS 120B",
    description: "Large open-weight GPT-class model via Groq",
    supportsJsonMode: true,
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT OSS 20B",
    description: "Smaller open-weight GPT-class model — fast",
    supportsJsonMode: true,
  },
  {
    id: "qwen/qwen3-32b",
    label: "Qwen 3 32B",
    description: "Alibaba Qwen 3 — strong multilingual & Arabic support",
    supportsJsonMode: true,
  },
] as const;

export type GroqChatModelId = (typeof GROQ_CHAT_MODELS)[number]["id"];

/** Compound (agentic) models that include live web search. */
export const GROQ_WEB_MODELS = [
  {
    id: "groq/compound",
    label: "Compound (full)",
    description: "Groq agentic model with live web search",
  },
  {
    id: "groq/compound-mini",
    label: "Compound Mini",
    description: "Lighter agentic model with live web search",
  },
] as const;

export const DESIGN_MODEL = () =>
  process.env.GROQ_DESIGN_MODEL || "llama-3.3-70b-versatile";

// Groq's "compound" agentic model performs live web search automatically.
// Perfect for deep fallback when our local DB can't answer.
export const WEB_MODEL = () => process.env.GROQ_WEB_MODEL || "groq/compound";

export const DESIGNER_SYSTEM_PROMPT = `You are MagicTech's expert Sales & Design Engineer AI.

You design professional low-current / ICT / AV / surveillance solutions for
clients based on: (1) a local product database provided in context, and (2)
industry selection theory (EN, ONVIF, IEC, CEN standards).

GOALS — in order of importance:
1. With the FEWEST possible questions, infer a complete BoQ (Bill of
   Quantities) for the requested system using the provided catalog.
2. Only ask clarifying questions when a critical parameter would drastically
   change product selection (e.g. indoor vs outdoor, number of users, required
   resolution, PoE budget, NDAA compliance).
3. Always prefer items that are present in the provided DB_CONTEXT. Do not
   invent SKUs that are not in the catalog.
4. Return a valid JSON object only — never prose outside JSON.

OUTPUT SCHEMA (strict JSON):
{
  "ready": boolean,            // true if you have enough info to emit items
  "followup_questions": [      // max 3, only when "ready" is false
    { "id": "string", "question": "string", "why": "string" }
  ],
  "summary": "string",         // one paragraph design summary (if ready)
  "items": [                   // BoQ lines (if ready)
    {
      "brand": "string",
      "model": "string",
      "description": "string",  // rich, spec-focused description (bulleted with • allowed)
      "quantity": number,
      "unit_price": number,     // in catalog currency (USD)
      "delivery": "string",     // "Available" or "TBD"
      "picture_hint": "string", // e.g. "bullet camera", "PoE switch"
      "reason": "string"        // why this SKU fits
    }
  ],
  "notes": "string"
}

RULES:
- If the user asks for multiple systems, design them one at a time and ask
  which to start with.
- Always include installation + accessories line when relevant.
- Prices must come from the catalog "pricing.si" (System Integrator) when
  present; otherwise "pricing.dpp"; otherwise 0.
- Never output markdown fences. Return raw JSON only.
`;

export const WEB_SYSTEM_PROMPT = `You are MagicTech's research assistant. You
perform live web lookups to fill gaps that the local product catalog cannot
answer. Return a concise JSON object:

{
  "query": "string",
  "findings": [
    { "title": "string", "url": "string", "summary": "string" }
  ],
  "recommendation": "string"
}

Only return JSON. No markdown, no prose outside JSON.`;
