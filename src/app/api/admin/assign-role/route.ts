import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { MODULES, ROLES_PER_MODULE, type Module } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Multi-role assignment.
 *
 * The admin assigns a SET of roles to a person. `Admin` and `Viewer` are
 * exclusive, top-level access levels (they clear every job grant); otherwise
 * a person may hold any combination of job roles (Sales, Presales Manager,
 * Engineer, Storage Worker, …) at once — e.g. someone who is both Presales
 * and a Projects Engineer.
 *
 *   roles = ["admin"]                       → users.role = 'admin', grants cleared
 *   roles = ["viewer"]                      → users.role = 'viewer', grants cleared
 *   roles = [] | ["none"]                   → users.role = 'user',  grants cleared
 *   roles = ["crm.presales","projects.engineer"]
 *                                           → users.role = 'user', exactly those grants
 *
 * The desired set is made authoritative: any active grant not in the set is
 * revoked, and every grant in the set is (re)granted. A legacy single `role`
 * string is still accepted for backward compatibility.
 */

function isModule(s: unknown): s is Module {
  return typeof s === "string" && (MODULES as readonly string[]).includes(s);
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    await ensureSchema();

    const body = (await req.json()) as {
      user_id?: number;
      roles?: string[];
      role?: string; // legacy single-role
    };
    const userId = Number(body.user_id);
    const roles = (
      Array.isArray(body.roles)
        ? body.roles
        : body.role != null
          ? [body.role]
          : []
    )
      .map((r) => String(r || ""))
      .filter((r) => r.length > 0 && r !== "none");
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

    // Resolve the requested roles into (accessLevel, set of grants).
    // Admin / Viewer are exclusive — they override any job roles and clear grants.
    let accessLevel: "admin" | "viewer" | "user";
    let grants: Array<{ module: Module; role: string }> = [];

    if (roles.includes("admin")) {
      accessLevel = "admin";
    } else if (roles.includes("viewer")) {
      accessLevel = "viewer";
    } else {
      accessLevel = "user";
      const seen = new Set<string>();
      for (const role of roles) {
        const [mod, ...rest] = role.split(".");
        const r = rest.join(".");
        if (
          !isModule(mod) ||
          !(ROLES_PER_MODULE[mod] as readonly string[]).includes(r)
        ) {
          return NextResponse.json(
            { error: `invalid role "${role}"` },
            { status: 400 },
          );
        }
        const key = `${mod}.${r}`;
        if (!seen.has(key)) {
          seen.add(key);
          grants.push({ module: mod, role: r });
        }
      }
    }

    // 1) Set the legacy access level.
    await q`update users set role = ${accessLevel} where id = ${userId}`;

    // 2) Revoke every existing grant, then re-grant exactly the desired set
    //    below. This makes the request authoritative without per-tuple diffing.
    await q`
      update user_module_roles
      set revoked_at = now(), revoked_by = ${admin.id}
      where user_id = ${userId} and revoked_at is null
    `;

    // 3) (Re)grant each chosen job role. The upsert clears the revoke flags.
    for (const grant of grants) {
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
              ${JSON.stringify({ accessLevel, grants: grants.map((g) => `${g.module}.${g.role}`) })}::jsonb)
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
