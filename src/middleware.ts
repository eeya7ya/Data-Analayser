import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

/**
 * Edge middleware that blocks every mutation API call from a viewer.
 *
 * Viewer accounts can see everything but must not change anything. The
 * cleanest enforcement is at the front door: any non-GET request to
 * `/api/**` is rejected with 403 when the session JWT has `role: viewer`.
 * Individual route handlers don't need to remember to add a check.
 *
 * Carve-outs:
 *   - GET / HEAD / OPTIONS pass through (reads).
 *   - `/api/auth/*` passes through so a logged-in viewer can still
 *     refresh `/auth/me` and sign out.
 *   - A small allowlist of POSTs that are conceptually read-only
 *     (search endpoints whose query is too large for a query string)
 *     also passes through.
 *
 * If the cookie is missing or invalid the middleware does nothing — the
 * route handler will issue its own 401 in that case.
 */

const COOKIE = "mt_session";
const ALG = "HS256";

const AUTH_PASS_THROUGH = new Set<string>([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
]);

const POST_READS = new Set<string>([
  "/api/database/search",
  // Click telemetry is conceptually read-only; let every role (incl. viewers)
  // post their clicks so the Syslog feed is complete.
  "/api/syslog",
]);

function isMutation(method: string): boolean {
  return (
    method === "POST" ||
    method === "PATCH" ||
    method === "PUT" ||
    method === "DELETE"
  );
}

export async function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  if (!isMutation(req.method)) return NextResponse.next();
  if (AUTH_PASS_THROUGH.has(req.nextUrl.pathname)) return NextResponse.next();
  if (POST_READS.has(req.nextUrl.pathname)) return NextResponse.next();

  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return NextResponse.next();

  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) return NextResponse.next();

  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, { algorithms: [ALG] });
    if (payload.role === "viewer") {
      return NextResponse.json(
        { error: "Viewer accounts are read-only." },
        { status: 403 },
      );
    }
  } catch {
    // invalid / expired token — let the route handler reject it.
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
