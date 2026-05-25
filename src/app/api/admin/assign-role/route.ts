import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { MODULES, ROLES_PER_MODULE, type Module } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Single-role assignment.
 *
 * The admin assigns ONE role to a person — Admin, Viewer, a job role
 * (Sales, Presales Manager, Engineer, …), or "none". That one choice
 * defines both their access level and what the app shows them, so this
 * endpoint collapses the legacy `users.role` column and the
 * `user_module_roles` grants into a single, consistent state:
 *
 *   role = "admin"      → users.role = 'admin', all module grants cleared
 *   role = "viewer"     → users.role = 'viewer', all module grants cleared
 *   role = "none"       → users.role = 'user',  all module grants cleared
 *   role = "crm.sales"  → users.role = 'user',  exactly that one grant
 *   (any "<module>.<role>" pair from the catalogue)
 *
 * Switching roles always revokes the previous module grants first, so a
 * person never ends up holding two jobs at once.
 */

function isModule(s: unknown): s is Module {
  return typeof s === "string" && (MODULES as readonly string[]).includes(s);
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    await ensureSchema();

    const body = (await req.json()) as { user_id?: number; role?: string };
    const userId = Number(body.user_id);
    const role = String(body.role || "");
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "invalid user_id" }, { status: 400 });
    }

    const q = sql();
    const userRows = (await q`
      select id from users where id = ${userId}
    `) as Array<{ id: number }>;
    if (userRows.length === 0) {
      return NextResponse.json({ error: "user not found" }, { status: 404 });
    }

    // Resolve the requested role into (accessLevel, optional grant).
    let accessLevel: "admin" | "viewer" | "user";
    let grant: { module: Module; role: string } | null = null;

    if (role === "admin") {
      accessLevel = "admin";
    } else if (role === "viewer") {
      accessLevel = "viewer";
    } else if (role === "none" || role === "") {
      accessLevel = "user";
    } else {
      const [mod, ...rest] = role.split(".");
      const r = rest.join(".");
      if (!isModule(mod) || !(ROLES_PER_MODULE[mod] as readonly string[]).includes(r)) {
        return NextResponse.json({ error: "invalid role" }, { status: 400 });
      }
      accessLevel = "user";
      grant = { module: mod, role: r };
    }

    // 1) Set the legacy access level.
    await q`update users set role = ${accessLevel} where id = ${userId}`;

    // 2) Clear every existing module grant (single-role model).
    await q`
      update user_module_roles
      set revoked_at = now(), revoked_by = ${admin.id}
      where user_id = ${userId} and revoked_at is null
    `;

    // 3) Re-grant the single chosen job role, if any.
    if (grant) {
      await q`
        insert into user_module_roles (user_id, module, role, granted_by, created_at)
        values (${userId}, ${grant.module}, ${grant.role}, ${admin.id}, now())
        on conflict (user_id, module, role) do update
          set granted_by = excluded.granted_by,
              created_at = excluded.created_at,
              revoked_at = null,
              revoked_by = null
      `;
    }

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${admin.id}, 'user', ${userId}, 'assign_role',
              ${JSON.stringify({ role })}::jsonb)
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
