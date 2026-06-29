import { NextResponse } from "next/server";
import { clearSessionCookie, getSessionUser } from "@/lib/auth";
import { recordSyslog } from "@/lib/syslog";

export const runtime = "nodejs";

export async function POST() {
  // Capture who is signing out before the cookie is cleared.
  const user = await getSessionUser();
  await clearSessionCookie();
  if (user) {
    void recordSyslog({
      actorId: user.id,
      entityType: "auth",
      entityId: user.id,
      verb: "logout",
      meta: { username: user.username, role: user.role },
    });
  }
  return NextResponse.json({ ok: true });
}
