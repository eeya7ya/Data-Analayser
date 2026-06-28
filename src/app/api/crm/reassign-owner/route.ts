import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { hasModuleRole } from "@/lib/modules";
import { getTenantUserIds } from "@/lib/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Move a created company or individual to another presales user.
 *
 * Presales owns the clients they create, and visibility is owner-scoped, so a
 * "move" has to reassign owner_id on the entity AND everything filed under it
 * (its folders, contacts, projects and quotations) — otherwise the new owner
 * would see an empty shell. The whole reassignment runs in one transaction so
 * a client never ends up half-moved.
 *
 *   GET  → the presales users in the caller's tenant that can receive a client.
 *   POST { kind: "company" | "individual", id, owner_id } → reassign.
 *
 * Who may move a client: an admin, the current owner (handing off their own
 * client), or a CRM presales_manager.
 */

type Kind = "company" | "individual";

/** True when `userId` holds an active CRM presales / presales_manager grant. */
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

    const body = (await req.json()) as {
      kind?: string;
      id?: number;
      owner_id?: number;
    };
    const kind = body.kind === "company" || body.kind === "individual"
      ? (body.kind as Kind)
      : null;
    const id = Number(body.id);
    const targetOwnerId = Number(body.owner_id);
    if (!kind || !Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "kind and id are required" }, { status: 400 });
    }
    if (!Number.isInteger(targetOwnerId) || targetOwnerId <= 0) {
      return NextResponse.json({ error: "owner_id is required" }, { status: 400 });
    }

    const q = sql();
    const isAdmin = canReadAll(user);

    // Resolve the entity and its current owner.
    let currentOwner: number | null = null;
    if (kind === "company") {
      const rows = (await q`
        select owner_id from companies where id = ${id} and deleted_at is null limit 1
      `) as Array<{ owner_id: number | null }>;
      if (rows.length === 0) {
        return NextResponse.json({ error: "company not found" }, { status: 404 });
      }
      currentOwner = rows[0].owner_id;
    } else {
      const rows = (await q`
        select owner_id from client_folders
        where id = ${id} and kind = 'individual' and deleted_at is null
        limit 1
      `) as Array<{ owner_id: number | null }>;
      if (rows.length === 0) {
        return NextResponse.json({ error: "individual not found" }, { status: 404 });
      }
      currentOwner = rows[0].owner_id;
    }

    // Authorisation: admin, the current owner, or a CRM presales manager.
    const mayMove =
      isAdmin ||
      currentOwner === user.id ||
      (await hasModuleRole(user.id, "crm", "presales_manager"));
    if (!mayMove) {
      return NextResponse.json(
        { error: "you can only move a client you own" },
        { status: 403 },
      );
    }

    // The destination must be a presales user inside the caller's tenant.
    const tenantIds = await getTenantUserIds(user.id);
    if (!tenantIds.includes(targetOwnerId)) {
      return NextResponse.json(
        { error: "target user is not in your tenant" },
        { status: 400 },
      );
    }
    if (!(await isPresalesUser(targetOwnerId))) {
      return NextResponse.json(
        { error: "target user is not a presales user" },
        { status: 400 },
      );
    }
    if (targetOwnerId === currentOwner) {
      return NextResponse.json({ ok: true, unchanged: true });
    }

    // Reassign the entity and everything filed under it, atomically.
    await q.begin(async (tx) => {
      if (kind === "company") {
        await tx`update companies set owner_id = ${targetOwnerId}, updated_at = now() where id = ${id}`;
        await tx`update client_folders set owner_id = ${targetOwnerId}, updated_at = now() where company_id = ${id}`;
        await tx`update contacts set owner_id = ${targetOwnerId}, updated_at = now()
                 where company_id = ${id}
                    or folder_id in (select id from client_folders where company_id = ${id})`;
        await tx`update projects set owner_id = ${targetOwnerId}, updated_at = now()
                 where folder_id in (select id from client_folders where company_id = ${id})`;
        await tx`update quotations set owner_id = ${targetOwnerId}, updated_at = now()
                 where folder_id in (select id from client_folders where company_id = ${id})`;
      } else {
        await tx`update client_folders set owner_id = ${targetOwnerId}, updated_at = now() where id = ${id}`;
        await tx`update contacts set owner_id = ${targetOwnerId}, updated_at = now() where folder_id = ${id}`;
        await tx`update projects set owner_id = ${targetOwnerId}, updated_at = now() where folder_id = ${id}`;
        await tx`update quotations set owner_id = ${targetOwnerId}, updated_at = now() where folder_id = ${id}`;
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
