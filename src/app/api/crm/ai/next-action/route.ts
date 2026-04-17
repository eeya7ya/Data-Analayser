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
      "You are a CRM coach. Recommend the single best next action for this contact: who to contact, " +
        "via what channel, with what message. Then list two backup actions in priority order. " +
        "Reply in this exact format:\n" +
        "PRIMARY: <one sentence>\n" +
        "WHY: <one sentence>\n" +
        "BACKUP 1: <one sentence>\n" +
        "BACKUP 2: <one sentence>",
    );
    return NextResponse.json({ recommendation: text.trim() });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
