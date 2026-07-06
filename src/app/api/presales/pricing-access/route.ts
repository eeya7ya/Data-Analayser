import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isPresalesManager } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Presales-manager pricing delegation.
 *
 * The presales manager decides which of their presales members may open the
 * Pricing module. Pricing is no longer auto-granted to every presales user —
 * the manager (or an admin) flips it per person here, which writes / revokes
 * an explicit `pricing.presales` grant in `user_module_roles`.
 *
 *   GET  → { members: [{ id, username, display_name, is_manager, has_pricing }] }
 *          the presales team (crm.presales / crm.presales_manager) with each
 *          member's current pricing access. Managers are always-on (auto).
 *   POST { user_id, enabled } → grant (enabled) or revoke the member's
 *          pricing access. Only the `pricing.presales` grant is touched, so an
 *          admin-set pricing.manager / pricing.sales grant is never disturbed.
 *
 * Access: crm presales_manager or admin only.
 */

async function requirePresalesManagerOrAdmin() {
  const user = await requireUser();
  if (!(await isPresalesManager(user))) throw new Error("FORBIDDEN");
  return user;
}

interface MemberRow {
  id: number;
  username: string;
  display_name: string | null;
  is_manager: boolean;
  has_pricing: boolean;
}

export async function GET() {
  try {
    await ensureSchema();
    await requirePresalesManagerOrAdmin();
    const q = sql();
    const rows = (await q`
      select u.id, u.username, u.display_name,
        exists (
          select 1 from user_module_roles m
          where m.user_id = u.id and m.module = 'crm'
            and m.role = 'presales_manager' and m.revoked_at is null
        ) as is_manager,
        exists (
          select 1 from user_module_roles p
          where p.user_id = u.id and p.module = 'pricing' and p.revoked_at is null
        ) as has_pricing
      from users u
      where exists (
        select 1 from user_module_roles c
        where c.user_id = u.id and c.module = 'crm'
          and c.role in ('presales', 'presales_manager')
          and c.revoked_at is null
      )
      order by coalesce(nullif(u.display_name, ''), u.username)
    `) as MemberRow[];
    return NextResponse.json({ members: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: Request) {
  try {
    await ensureSchema();
    const actor = await requirePresalesManagerOrAdmin();
    const body = (await req.json()) as {
      user_id?: number;
      enabled?: boolean;
    };
    const userId = Number(body.user_id);
    const enabled = Boolean(body.enabled);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "invalid user_id" }, { status: 400 });
    }

    const q = sql();
    // The target must actually be a presales member — the manager may only
    // delegate pricing to their own team, never grant it to arbitrary users.
    const eligible = (await q`
      select 1 as ok from user_module_roles
      where user_id = ${userId} and module = 'crm'
        and role in ('presales', 'presales_manager')
        and revoked_at is null
      limit 1
    `) as Array<{ ok: number }>;
    if (eligible.length === 0) {
      return NextResponse.json(
        { error: "user is not a presales member" },
        { status: 400 },
      );
    }

    if (enabled) {
      // Grant (or un-revoke) exactly the delegated pricing.presales role.
      await q`
        insert into user_module_roles (user_id, module, role, granted_by, created_at)
        values (${userId}, 'pricing', 'presales', ${actor.id}, now())
        on conflict (user_id, module, role) do update
          set granted_by = excluded.granted_by,
              created_at = excluded.created_at,
              revoked_at = null,
              revoked_by = null
      `;
    } else {
      // Revoke only the delegated pricing.presales grant. An admin-set
      // pricing.manager / pricing.sales grant is intentionally left intact.
      await q`
        update user_module_roles
        set revoked_at = now(), revoked_by = ${actor.id}
        where user_id = ${userId} and module = 'pricing' and role = 'presales'
          and revoked_at is null
      `;
    }

    // Best-effort audit — never block the change on a logging failure.
    try {
      await q`
        insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
        values (${actor.id}, 'user', ${userId}, 'pricing_access',
                ${JSON.stringify({ enabled })}::jsonb)
      `;
    } catch {
      // ignore
    }

    return NextResponse.json({ ok: true, enabled });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
