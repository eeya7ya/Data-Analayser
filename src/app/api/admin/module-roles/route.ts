import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { MODULES, ROLES_PER_MODULE, type Module } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin module-role management.
 *
 *   GET    — list every active grant + every user with zero module roles
 *            (the "Pending role assignment" queue surfaced in the upcoming
 *            Phase 3 admin UI) + the catalogue of valid (module, role)
 *            pairs so the UI doesn't hard-code them.
 *   POST   — grant a (module, role) to a user. UPSERTs over a previously
 *            revoked grant so the old row stays in place but `revoked_at`
 *            clears. Idempotent: re-granting an active role is a no-op.
 *   PATCH  — soft-revoke a grant by stamping `revoked_at` + `revoked_by`.
 *            The row is NEVER deleted, so a future re-grant restores
 *            access cleanly and the audit history of who held what
 *            survives.
 *
 * There is intentionally no DELETE handler. Removal of module access
 * is always reversible. Legacy `users.role = 'admin'` is left alone
 * here — admins always pass requireModule() regardless of
 * user_module_roles content, so revoking an admin's `admin.admin`
 * grant does NOT lock them out as long as `users.role = 'admin'`.
 */

function isModule(s: unknown): s is Module {
  return typeof s === "string" && (MODULES as readonly string[]).includes(s);
}

function isValidRole(module: Module, role: string): boolean {
  return (ROLES_PER_MODULE[module] as readonly string[]).includes(role);
}

interface GrantRow {
  user_id: number;
  username: string;
  module: Module;
  role: string;
  granted_by: number | null;
  granted_by_username: string | null;
  created_at: string;
}

interface PendingUser {
  id: number;
  username: string;
  display_name: string;
  legacy_role: string;
}

export async function GET() {
  try {
    await requireAdmin();
    await ensureSchema();
    const q = sql();

    const grants = (await q`
      select umr.user_id,
             u.username,
             umr.module,
             umr.role,
             umr.granted_by,
             gu.username as granted_by_username,
             umr.created_at
      from user_module_roles umr
      join users u on u.id = umr.user_id
      left join users gu on gu.id = umr.granted_by
      where umr.revoked_at is null
      order by u.username, umr.module, umr.role
    `) as GrantRow[];

    const pending = (await q`
      select u.id, u.username, u.display_name, u.role as legacy_role
      from users u
      where not exists (
        select 1 from user_module_roles umr
        where umr.user_id = u.id and umr.revoked_at is null
      )
      order by u.username
    `) as PendingUser[];

    return NextResponse.json({
      grants,
      pending,
      catalogue: Object.fromEntries(
        MODULES.map((m) => [m, ROLES_PER_MODULE[m]]),
      ),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    await ensureSchema();

    const body = (await req.json()) as {
      user_id?: number;
      module?: string;
      role?: string;
    };
    const userId = Number(body.user_id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "invalid user_id" }, { status: 400 });
    }
    if (!isModule(body.module)) {
      return NextResponse.json({ error: "invalid module" }, { status: 400 });
    }
    const role = String(body.role || "");
    if (!isValidRole(body.module, role)) {
      return NextResponse.json(
        { error: `invalid role for module ${body.module}` },
        { status: 400 },
      );
    }

    const q = sql();

    // Confirm the target user exists. We don't want to leave an orphan
    // grant pointing at a non-existent user, even though the FK would
    // catch it — a 404 is friendlier than a foreign-key violation.
    const userRows = (await q`
      select id from users where id = ${userId}
    `) as Array<{ id: number }>;
    if (userRows.length === 0) {
      return NextResponse.json({ error: "user not found" }, { status: 404 });
    }

    // UPSERT: re-granting a previously revoked role clears the revoke
    // columns and stamps a fresh granted_by/created_at so the new grant
    // is auditable as its own event. Active grants are unchanged.
    await q`
      insert into user_module_roles (user_id, module, role, granted_by, created_at)
      values (${userId}, ${body.module}, ${role}, ${admin.id}, now())
      on conflict (user_id, module, role) do update
        set granted_by = excluded.granted_by,
            created_at = excluded.created_at,
            revoked_at = null,
            revoked_by = null
    `;

    await q`
      insert into syslog (actor_id, entity_type, entity_id, verb, meta_json)
      values (${admin.id}, 'user_module_role', ${userId}, 'grant',
              ${JSON.stringify({ module: body.module, role })}::jsonb)
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    await ensureSchema();

    const body = (await req.json()) as {
      user_id?: number;
      module?: string;
      role?: string;
    };
    const userId = Number(body.user_id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "invalid user_id" }, { status: 400 });
    }
    if (!isModule(body.module)) {
      return NextResponse.json({ error: "invalid module" }, { status: 400 });
    }
    const role = String(body.role || "");
    if (!isValidRole(body.module, role)) {
      return NextResponse.json(
        { error: `invalid role for module ${body.module}` },
        { status: 400 },
      );
    }

    const q = sql();
    const result = (await q`
      update user_module_roles
      set revoked_at = now(), revoked_by = ${admin.id}
      where user_id = ${userId}
        and module = ${body.module}
        and role = ${role}
        and revoked_at is null
      returning user_id
    `) as Array<{ user_id: number }>;

    if (result.length === 0) {
      return NextResponse.json(
        { error: "no active grant matching that triple" },
        { status: 404 },
      );
    }

    await q`
      insert into syslog (actor_id, entity_type, entity_id, verb, meta_json)
      values (${admin.id}, 'user_module_role', ${userId}, 'revoke',
              ${JSON.stringify({ module: body.module, role })}::jsonb)
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
