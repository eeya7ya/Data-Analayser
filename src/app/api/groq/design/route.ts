import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  DESIGNER_SYSTEM_PROMPT,
  DESIGN_MODEL,
  GROQ_CHAT_MODELS,
  groqClient,
  type GroqChatModelId,
} from "@/lib/groq";
import {
  findSystem,
  loadSystem,
  searchProducts,
  globalSearch,
} from "@/lib/search";

export const runtime = "nodejs";

/**
 * POST /api/groq/design
 * Body: { systemId, userBrief, history?, answers? }
 *
 * Returns the strict JSON the DESIGNER_SYSTEM_PROMPT asks for.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = (await req.json()) as {
      systemId?: number | string;
      userBrief: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
      answers?: Record<string, string>;
      model?: GroqChatModelId;
    };

    if (!body.userBrief || body.userBrief.trim().length < 3) {
      return NextResponse.json(
        { error: "userBrief is required" },
        { status: 400 },
      );
    }

    // Build grounded DB context — prefer a specific system, else global search.
    let dbContext: unknown;
    let theoryContext: unknown = null;
    let systemMeta: unknown = null;

    if (body.systemId) {
      const system = await findSystem(body.systemId);
      if (!system) {
        return NextResponse.json(
          { error: "System not found" },
          { status: 404 },
        );
      }
      const { db, theory } = await loadSystem(system);
      const hits = searchProducts(db, { text: body.userBrief, limit: 25 });
      dbContext = hits.length > 0 ? hits : db.products?.slice(0, 25) || [];
      theoryContext = theory;
      systemMeta = {
        vendor: system.vendor,
        category: system.category,
        name: system.name,
        currency: system.currency,
      };
    } else {
      const hits = await globalSearch(body.userBrief, 20);
      dbContext = hits;
      systemMeta = { vendor: "MULTI", category: "cross-vendor" };
    }

    const groq = groqClient();

    const contextPayload = {
      system: systemMeta,
      theory_excerpt: theoryContext,
      db_candidates: dbContext,
      prior_answers: body.answers || {},
    };

    const messages = [
      { role: "system" as const, content: DESIGNER_SYSTEM_PROMPT },
      {
        role: "system" as const,
        content: `DB_CONTEXT (JSON):\n${JSON.stringify(contextPayload).slice(0, 60_000)}`,
      },
      ...(body.history || []).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: body.userBrief },
    ];

    // Use caller-supplied model if it is in the known catalog, else env/default.
    const allowedIds = GROQ_CHAT_MODELS.map((m) => m.id as string);
    const requestedModel = body.model && allowedIds.includes(body.model)
      ? body.model
      : DESIGN_MODEL();
    const modelMeta = GROQ_CHAT_MODELS.find((m) => m.id === requestedModel);
    const supportsJson = modelMeta?.supportsJsonMode !== false;

    const completion = await groq.chat.completions.create({
      model: requestedModel,
      temperature: 0.2,
      ...(supportsJson ? { response_format: { type: "json_object" } } : {}),
      messages,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { ready: false, raw, error: "Model returned non-JSON" };
    }
    return NextResponse.json({ model: requestedModel, result: parsed });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "design failed" },
      { status: 500 },
    );
  }
}
