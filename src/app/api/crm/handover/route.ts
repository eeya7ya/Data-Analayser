import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
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

    // An admin is the de-facto owner of legacy/unowned records (owner_id NULL),
    // so an admin handover also sweeps those — that's why "not all" moved
    // before. A non-admin only hands over rows they explicitly own.
    const isAdmin = canReadAll(user);
    const q = sql();
    const moved = await q.begin(async (tx) => {
      const orNullOwner = isAdmin ? tx`or owner_id is null` : tx``;
      const orNullUser = isAdmin ? tx`or user_id is null` : tx``;
      const orNullCreatedByUser = isAdmin
        ? tx`or created_by_user_id is null`
        : tx``;
      const orNullCreated = isAdmin ? tx`or created_by is null` : tx``;
      const orNullAssigned = isAdmin ? tx`or assigned_to_id is null` : tx``;
      let n = 0;
      // CRM book of business (kept updated_at fresh so it surfaces for the new owner).
      n += (await tx`update companies      set owner_id = ${to}, updated_at = now() where owner_id = ${from} ${orNullOwner}`).count;
      n += (await tx`update client_folders set owner_id = ${to}, updated_at = now() where owner_id = ${from} ${orNullOwner}`).count;
      n += (await tx`update contacts       set owner_id = ${to}, updated_at = now() where owner_id = ${from} ${orNullOwner}`).count;
      n += (await tx`update projects       set owner_id = ${to}, updated_at = now() where owner_id = ${from} ${orNullOwner}`).count;
      n += (await tx`update quotations     set owner_id = ${to}, updated_at = now() where owner_id = ${from} ${orNullOwner}`).count;
      // Sales / project artifacts owned by the user.
      n += (await tx`update purchase_orders set owner_id = ${to} where owner_id = ${from} ${orNullOwner}`).count;
      n += (await tx`update project_files   set owner_id = ${to} where owner_id = ${from} ${orNullOwner}`).count;
      // Pricing projects — owned via user_id, not owner_id.
      n += (await tx`update pricing_projects set user_id = ${to} where user_id = ${from} ${orNullUser}`).count;
      // Pricing manufacturers: transfer creatorship AND grant the member access.
      // Non-admins only see manufacturers they hold a pricing_user_manufacturers
      // grant for, which is why the member's Pricing Dashboard showed "No
      // manufacturers yet" after a handover.
      n += (await tx`update pricing_manufacturers set created_by_user_id = ${to} where created_by_user_id = ${from} ${orNullCreatedByUser}`).count;
      if (isAdmin) {
        // The admin sees every manufacturer — grant the member all of them.
        n += (await tx`
          insert into pricing_user_manufacturers (user_id, manufacturer_id, color, tag, created_at)
          select ${to}, m.id, 'cyan', '', now()
          from pricing_manufacturers m
          where m.deleted_at is null
          on conflict (user_id, manufacturer_id) do update set deleted_at = null
        `).count;
      } else {
        // Move the source's manufacturer grants to the member.
        n += (await tx`
          insert into pricing_user_manufacturers (user_id, manufacturer_id, color, tag, created_at)
          select ${to}, pum.manufacturer_id, pum.color, pum.tag, now()
          from pricing_user_manufacturers pum
          where pum.user_id = ${from} and pum.deleted_at is null
          on conflict (user_id, manufacturer_id) do update set deleted_at = null
        `).count;
      }
      // Full move: the source relinquishes its OWN manufacturer pins so the
      // member becomes the sole owner — a handover is a move, not a copy.
      // (An admin still sees every workspace by role via the cross-user pin
      // listing, but the source's own cards now belong to the member; a
      // non-admin source loses access outright.) Done after the grants above
      // so the member's freshly-inserted pin — keyed on `to`, never `from`
      // since `to !== from` — is untouched.
      n += (await tx`
        update pricing_user_manufacturers
        set deleted_at = now()
        where user_id = ${from} and deleted_at is null
      `).count;
      // Leads — owned via created_by, plus the assignee.
      n += (await tx`update leads set created_by = ${to} where created_by = ${from} ${orNullCreated}`).count;
      n += (await tx`update leads set assigned_to_id = ${to} where assigned_to_id = ${from} ${orNullAssigned}`).count;
      return n;
    });

    return NextResponse.json({ ok: true, moved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
