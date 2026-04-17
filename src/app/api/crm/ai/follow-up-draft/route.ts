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
    const body = (await req.json()) as { contact_id?: number; tone?: string };
    if (!body.contact_id) throw new Error("BAD_REQUEST");
    const ctx = await loadContactContext(body.contact_id);
    if (!ctx) throw new Error("NOT_FOUND");
    const tone = (body.tone ?? "professional").trim();
    const text = await chatJson(
      JSON.stringify(ctx, null, 2),
      `Draft a short follow-up email (under 120 words) to this contact. Tone: ${tone}. Reference the ` +
        "most recent meaningful activity if any. Do not invent facts. Output:\n" +
        "SUBJECT: <line>\n" +
        "BODY:\n<email body, ready to send>",
    );
    return NextResponse.json({ draft: text.trim() });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
