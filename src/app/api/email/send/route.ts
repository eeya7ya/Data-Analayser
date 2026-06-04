import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import {
  sendMailForUser,
  describeEmailError,
  EmailNotConfiguredError,
} from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const body = (await req.json()) as {
      to?: string;
      subject?: string;
      text?: string;
      html?: string;
    };
    const to = String(body.to ?? "").trim();
    const subject = String(body.subject ?? "").trim();
    const text = String(body.text ?? "");
    if (!to) {
      return NextResponse.json(
        { error: "A recipient is required." },
        { status: 400 },
      );
    }
    await sendMailForUser(user.id, {
      to,
      subject: subject || "(no subject)",
      text,
      html: body.html,
    });
    return NextResponse.json({ ok: true });
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
