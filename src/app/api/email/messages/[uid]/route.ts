import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import {
  fetchMessageForUser,
  describeEmailError,
  EmailNotConfiguredError,
} from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ uid: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { uid: uidParam } = await ctx.params;
    const uid = Number(uidParam);
    if (!Number.isInteger(uid) || uid <= 0) {
      return NextResponse.json({ error: "Invalid message id." }, { status: 400 });
    }
    const message = await fetchMessageForUser(user.id, uid);
    if (!message) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }
    return NextResponse.json({ message });
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) {
      return NextResponse.json(
        { error: err.message, notConfigured: true },
        { status: 409 },
      );
    }
    const msg = err instanceof Error ? err.message : "";
    if (msg === "UNAUTHENTICATED")
      return NextResponse.json({ error: msg }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ error: msg }, { status: 403 });
    return NextResponse.json(
      { error: describeEmailError(err) },
      { status: 502 },
    );
  }
}
