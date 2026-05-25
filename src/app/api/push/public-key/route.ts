import { NextResponse } from "next/server";
import { vapidPublicKey } from "@/lib/push";

export const runtime = "nodejs";

/**
 * Hands the browser the VAPID public key it needs to create a push
 * subscription. Returns `{ key: null }` when push isn't configured so the
 * client can hide the "enable notifications" affordance instead of
 * attempting a doomed subscribe.
 */
export async function GET() {
  return NextResponse.json({ key: vapidPublicKey() });
}
