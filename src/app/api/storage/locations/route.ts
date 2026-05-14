import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { hasModule, hasModuleRole } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Storage locations.
 *
 *   GET    — any storage.* user, any projects.* user (needs to know
 *            where to request from), or admin. The list is short
 *            (warehouses) so no pagination.
 *   POST   — storage.manager or admin. Creates a new location. Idempotent
 *            on `name` (unique constraint at the DB level).
 *   PATCH  — storage.manager or admin. Renames or soft-archives.
 *            Setting `deleted_at` via PATCH archives the location; the
 *            row and its stock history stay queryable. No DELETE
 *            handler — archive is the destructive-most operation.
 */

interface LocationRow {
  id: number;
  name: string;
  address: string | null;
  created_at: string;
  deleted_at: string | null;
}

async function canManageStorage(
  userId: number,
  userRole: string,
): Promise<boolean> {
  if (userRole === "admin") return true;
  return hasModuleRole(userId, "storage", "manager");
}

async function canReadStorage(
  userId: number,
  userRole: string,
): Promise<boolean> {
  if (userRole === "admin") return true;
  if (await hasModule(userId, "storage")) return true;
  if (await hasModule(userId, "projects")) return true;
  return false;
}

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    if (!(await canReadStorage(user.id, user.role))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const q = sql();
    const rows = (await q`
      select id, name, address, created_at, deleted_at
      from storage_locations
      order by (deleted_at is not null), name
    `) as LocationRow[];
    return NextResponse.json({ locations: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await ensureSchema();
    if (!(await canManageStorage(user.id, user.role))) {
      return NextResponse.json(
        { error: "requires storage.manager or admin" },
        { status: 403 },
      );
    }
    const body = (await req.json()) as { name?: string; address?: string };
    const name = String(body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    const address = String(body.address ?? "").trim() || null;
    const q = sql();
    const existing = (await q`
      select id from storage_locations where name = ${name}
    `) as Array<{ id: number }>;
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "a location with that name already exists" },
        { status: 409 },
      );
    }
    const inserted = (await q`
      insert into storage_locations (name, address)
      values (${name}, ${address})
      returning id, name, address, created_at, deleted_at
    `) as LocationRow[];
    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'storage_location', ${inserted[0].id}, 'create',
              ${JSON.stringify({ name, address })}::jsonb)
    `;
    return NextResponse.json({ location: inserted[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    await ensureSchema();
    if (!(await canManageStorage(user.id, user.role))) {
      return NextResponse.json(
        { error: "requires storage.manager or admin" },
        { status: 403 },
      );
    }
    const body = (await req.json()) as {
      id?: number;
      name?: string;
      address?: string | null;
      archived?: boolean;
    };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const q = sql();
    const existing = (await q`
      select id from storage_locations where id = ${id}
    `) as Array<{ id: number }>;
    if (existing.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) {
        return NextResponse.json(
          { error: "name cannot be empty" },
          { status: 400 },
        );
      }
      await q`update storage_locations set name = ${name} where id = ${id}`;
    }
    if (body.address !== undefined) {
      const address =
        body.address === null ? null : String(body.address).trim() || null;
      await q`update storage_locations set address = ${address} where id = ${id}`;
    }
    if (body.archived !== undefined) {
      await q`
        update storage_locations
        set deleted_at = ${body.archived ? new Date().toISOString() : null}
        where id = ${id}
      `;
    }

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'storage_location', ${id}, 'update', ${JSON.stringify(body)}::jsonb)
    `;

    const updated = (await q`
      select id, name, address, created_at, deleted_at
      from storage_locations where id = ${id}
    `) as LocationRow[];
    return NextResponse.json({ location: updated[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
