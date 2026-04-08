import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { WEB_MODEL, WEB_SYSTEM_PROMPT, groqClient } from "@/lib/groq";

export const runtime = "nodejs";

/**
 * POST /api/groq/web
 * Body: { query: string }
 *
 * Uses Groq's agentic "compound" model which performs live web search
 * internally. Falls back to llama-3.3-70b if the compound model is unavailable.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const { query } = (await req.json()) as { query?: string };
    if (!query || query.trim().length < 3) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const groq = groqClient();
    const messages = [
      { role: "system" as const, content: WEB_SYSTEM_PROMPT },
      { role: "user" as const, content: query },
    ];

    let model = WEB_MODEL();
    let completion;
    try {
      completion = await groq.chat.completions.create({
        model,
        temperature: 0.2,
        messages,
      });
    } catch (err) {
      // Graceful fallback if the compound model is not enabled on the key.
      model = "llama-3.3-70b-versatile";
      completion = await groq.chat.completions.create({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              WEB_SYSTEM_PROMPT +
              "\n\nNote: you do not have web access in this fallback; respond with your best-effort general knowledge and mark URLs as 'n/a'.",
          },
          { role: "user", content: query },
        ],
      });
      void err;
    }

    const raw = completion.choices[0]?.message?.content || "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { query, recommendation: raw, findings: [] };
    }
    return NextResponse.json({ model, result: parsed });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "web search failed" },
      { status: 500 },
    );
  }
}
