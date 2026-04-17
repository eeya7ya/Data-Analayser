import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";
import { loadContactContext, chatJson } from "@/lib/crm/ai";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const body = (await req.json()) as { contact_id?: number };
    if (!body.contact_id) throw new Error("BAD_REQUEST");
    const ctx = await loadContactContext(body.contact_id);
    if (!ctx) throw new Error("NOT_FOUND");
    const text = await chatJson(
      JSON.stringify(ctx, null, 2),
      "You are a CRM assistant. Summarise this contact in 4-6 short bullet points: who they are, " +
        "the company context, recent engagement, open deals, and the single most important risk or " +
        "opportunity. Be concise and concrete. Plain text only — no markdown, no preamble.",
    );
    return NextResponse.json({ summary: text.trim() });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
