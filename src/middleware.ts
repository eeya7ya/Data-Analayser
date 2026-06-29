import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

/**
 * Edge middleware — the single front-door gate for two cross-cutting
 * access rules that individual route handlers no longer need to repeat:
 *
 *  1. Admins are walled off from the CRM entirely. The `admin` role is a
 *     pure system administrator (users, roles, settings, branding,
 *     backups) — separation of duties keeps all client / sales / project
 *     / pricing data out of the admin's reach. This is enforced for BOTH
 *     page navigation (redirect to /admin) and the data APIs (403), so it
 *     is real backend enforcement, not just UI hiding. The read-only
 *     `viewer` (watcher) role is unaffected and keeps its full read view.
 *
 *  2. Viewer accounts are read-only. Any mutating `/api/**` request from a
 *     viewer session is rejected with 403.
 *
 * If the cookie is missing or invalid the middleware does nothing — the
 * route handler / page issues its own 401 / redirect in that case.
 */

const COOKIE = "mt_session";
const ALG = "HS256";

const AUTH_PASS_THROUGH = new Set<string>([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
]);

const POST_READS = new Set<string>(["/api/database/search"]);

/**
 * CRM hub page trees the admin role must never reach. `/crm` carries the
 * Sales / Presales / Storage / Projects / Pricing tabs and the client
 * drill-down; the rest are the modules those tabs link out to. Admin is
 * redirected to /admin instead.
 */
const ADMIN_BLOCKED_PAGES = [
  "/crm",
  "/leads",
  "/projects",
  "/pricing",
  "/folder",
  "/purchase-orders",
];

/**
 * API trees that exclusively serve the CRM hub. `/api/quotations` is
 * deliberately absent: the admin Files / Database backup reads quotations
 * to export them, which is a data-custodian function, not CRM browsing —
 * blocking it would break the backup. Likewise `/api/admin/*` stays open
 * (that IS the admin surface).
 */
const ADMIN_BLOCKED_API = [
  "/api/crm",
  "/api/leads",
  "/api/pricing",
  "/api/projects",
  "/api/project-assignments",
  "/api/project-handoffs",
  "/api/project-tasks",
  "/api/project-files",
  "/api/companies",
  "/api/contacts",
  "/api/folders",
  "/api/purchase-orders",
  "/api/stock-checks",
  "/api/storage",
  "/api/execution-reports",
  "/api/trash",
];

function isMutation(method: string): boolean {
  return (
    method === "POST" ||
    method === "PATCH" ||
    method === "PUT" ||
    method === "DELETE"
  );
}

/** Prefix match that treats `/crm` and `/crm/...` as hits but not `/crmx`. */
function matchesPrefix(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(p + "/"));
}

/** Read the session role from the JWT cookie, or null if absent/invalid. */
async function readRole(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return null;
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) return null;
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, { algorithms: [ALG] });
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    // invalid / expired token — let the route handler / page reject it.
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // ── Page navigation: keep admins out of the CRM hub entirely. ──────────
  if (!isApi) {
    if (matchesPrefix(pathname, ADMIN_BLOCKED_PAGES)) {
      const role = await readRole(req);
      if (role === "admin") {
        const url = req.nextUrl.clone();
        url.pathname = "/admin";
        url.search = "";
        return NextResponse.redirect(url);
      }
    }
    return NextResponse.next();
  }

  // ── API: decide which gates apply, then read the role at most once. ────
  const blockedApi =
    matchesPrefix(pathname, ADMIN_BLOCKED_API) &&
    !AUTH_PASS_THROUGH.has(pathname);
  const viewerGated =
    isMutation(req.method) &&
    !AUTH_PASS_THROUGH.has(pathname) &&
    !POST_READS.has(pathname);

  if (!blockedApi && !viewerGated) return NextResponse.next();

  const role = await readRole(req);

  if (blockedApi && role === "admin") {
    return NextResponse.json(
      { error: "Admin accounts cannot access the CRM." },
      { status: 403 },
    );
  }
  if (viewerGated && role === "viewer") {
    return NextResponse.json(
      { error: "Viewer accounts are read-only." },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/crm",
    "/crm/:path*",
    "/leads",
    "/leads/:path*",
    "/projects",
    "/projects/:path*",
    "/pricing",
    "/pricing/:path*",
    "/folder",
    "/folder/:path*",
    "/purchase-orders",
    "/purchase-orders/:path*",
  ],
};
