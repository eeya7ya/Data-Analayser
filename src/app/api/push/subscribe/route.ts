import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Store / remove a browser push subscription for the current user.
 *
 *   POST   { endpoint, keys: { p256dh, auth } }  → upsert (one row per
 *           endpoint; re-subscribing the same device re-points it at this
 *           user without duplicating).
 *   DELETE { endpoint }                          → remove this device's
 *           subscription (called when the user turns notifications off).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const body = (await req.json()) as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    const endpoint = String(body.endpoint || "").trim();
    const p256dh = String(body.keys?.p256dh || "").trim();
    const auth = String(body.keys?.auth || "").trim();
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { error: "endpoint and keys are required" },
        { status: 400 },
      );
    }
    const ua = (req.headers.get("user-agent") || "").slice(0, 300);
    const q = sql();
    await q`
      insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
      values (${user.id}, ${endpoint}, ${p256dh}, ${auth}, ${ua})
      on conflict (endpoint)
      do update set user_id = ${user.id}, p256dh = ${p256dh}, auth = ${auth},
                    user_agent = ${ua}
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
    const endpoint = String(body.endpoint || "").trim();
    if (!endpoint) {
      return NextResponse.json({ error: "endpoint required" }, { status: 400 });
    }
    const q = sql();
    await q`
      delete from push_subscriptions
      where endpoint = ${endpoint} and user_id = ${user.id}
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
