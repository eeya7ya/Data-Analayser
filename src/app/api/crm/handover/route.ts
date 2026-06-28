import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { hasModuleRole } from "@/lib/modules";
import { getTenantUserIds } from "@/lib/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-click handover: move ALL of the current user's presales work — every
 * company, individual, contact, project, quotation and lead they own — to a
 * presales member, in one transaction. This is how an admin who has been doing
 * presales hands the whole book of business to a teammate.
 *
 *   GET  → presales members in the tenant (excluding the caller).
 *   POST { to } → reassign everything the caller owns to that member.
 */

async function isPresalesUser(userId: number): Promise<boolean> {
  return (
    (await hasModuleRole(userId, "crm", "presales")) ||
    (await hasModuleRole(userId, "crm", "presales_manager"))
  );
}

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    const tenantIds = await getTenantUserIds(user.id);
    const q = sql();
    const rows = (await q`
      select distinct u.id,
             coalesce(nullif(u.display_name, ''), u.username) as name
      from users u
      join user_module_roles r on r.user_id = u.id
      where r.module = 'crm'
        and r.role in ('presales', 'presales_manager')
        and r.revoked_at is null
        and u.id = any(${tenantIds}::int[])
        and u.id <> ${user.id}
      order by name asc
    `) as Array<{ id: number; name: string }>;
    return NextResponse.json({ users: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();

    const body = (await req.json()) as { to?: number };
    const to = Number(body.to);
    const from = user.id;
    if (!Number.isInteger(to) || to <= 0) {
      return NextResponse.json({ error: "a target member is required" }, { status: 400 });
    }
    if (to === from) {
      return NextResponse.json({ error: "can't hand over to yourself" }, { status: 400 });
    }

    const tenantIds = await getTenantUserIds(user.id);
    if (!tenantIds.includes(to)) {
      return NextResponse.json({ error: "target is not in your tenant" }, { status: 400 });
    }
    if (!(await isPresalesUser(to))) {
      return NextResponse.json({ error: "target is not a presales user" }, { status: 400 });
    }

    const q = sql();
    const moved = await q.begin(async (tx) => {
      let n = 0;
      n += (await tx`update companies set owner_id = ${to}, updated_at = now() where owner_id = ${from}`).count;
      n += (await tx`update client_folders set owner_id = ${to}, updated_at = now() where owner_id = ${from}`).count;
      n += (await tx`update contacts set owner_id = ${to}, updated_at = now() where owner_id = ${from}`).count;
      n += (await tx`update projects set owner_id = ${to}, updated_at = now() where owner_id = ${from}`).count;
      n += (await tx`update quotations set owner_id = ${to}, updated_at = now() where owner_id = ${from}`).count;
      n += (await tx`update leads set created_by = ${to} where created_by = ${from}`).count;
      n += (await tx`update leads set assigned_to_id = ${to} where assigned_to_id = ${from}`).count;
      return n;
    });

    return NextResponse.json({ ok: true, moved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
