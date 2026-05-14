import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getUserModuleRoles } from "@/lib/modules";

export const runtime = "nodejs";

/**
 * Returns the current session user + their active module-role grants
 * so client components (e.g. QuotationApprovalBar) can decide which
 * action buttons to render. Returns an empty `module_roles` array
 * when not logged in or no grants exist — admins still pass
 * server-side gates via legacy `users.role = 'admin'` regardless of
 * this list, so the field is for UI affordance only.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ user: null, module_roles: [] });
  }
  const grants = await getUserModuleRoles(user.id);
  return NextResponse.json({
    user,
    module_roles: grants.map((g) => ({ module: g.module, role: g.role })),
  });
}
