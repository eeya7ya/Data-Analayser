import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import {
  fetchInboxForUser,
  describeEmailError,
  EmailNotConfiguredError,
} from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const limit = Math.min(
      100,
      Math.max(1, Number(searchParams.get("limit")) || 30),
    );
    const messages = await fetchInboxForUser(user.id, limit);
    return NextResponse.json({ messages });
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) {
      return NextResponse.json(
        { error: err.message, notConfigured: true },
        { status: 409 },
      );
    }
    const auth = authStatus(err);
    if (auth) return auth;
    return NextResponse.json(
      { error: describeEmailError(err) },
      { status: 502 },
    );
  }
}

function authStatus(err: unknown): NextResponse | null {
  const msg = err instanceof Error ? err.message : "";
  if (msg === "UNAUTHENTICATED")
    return NextResponse.json({ error: msg }, { status: 401 });
  if (msg === "FORBIDDEN")
    return NextResponse.json({ error: msg }, { status: 403 });
  return null;
}
