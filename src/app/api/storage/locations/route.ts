import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { hasModule, hasModuleRole } from "@/lib/modules";

export const runtime = "nodejs";

/**
 * Storage V1.5A — location TREE (Feature 4). Every node knows only its
 * `name` and its `parent_id`; the full address is walked from the parents
 * at read time via a recursive CTE (never stored as a string). Reads are
 * open to any storage / admin user; mutations require a storage manager
 * (or admin).
 */

async function canManage(userId: number, isAdmin: boolean): Promise<boolean> {
  return isAdmin || (await hasModuleRole(userId, "storage", "manager"));
}

// GET — every node with its computed full path + depth (archived included,
// flagged via deleted_at so the UI can fade them).
export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    const isAdmin = canReadAll(user);
    if (!isAdmin && !(await hasModule(user.id, "storage"))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const q = sql();
    const nodes = (await q`
      with recursive tree as (
        select id, parent_id, name, deleted_at,
               name::text as path, 0 as depth
        from stock_location_nodes
        where parent_id is null
        union all
        select n.id, n.parent_id, n.name, n.deleted_at,
               t.path || ' › ' || n.name, t.depth + 1
        from stock_location_nodes n
        join tree t on n.parent_id = t.id
      )
      select id, parent_id, name, deleted_at, path, depth
      from tree
      order by path
    `) as Array<Record<string, unknown>>;
    return NextResponse.json({ nodes });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}

// POST { name, parent_id? } — create a node.
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const isAdmin = canReadAll(user);
    if (!(await canManage(user.id, isAdmin))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const body = (await req.json()) as { name?: string; parent_id?: number | null };
    const name = String(body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const parentId =
      body.parent_id == null ? null : Number(body.parent_id);
    if (parentId != null && !Number.isInteger(parentId)) {
      return NextResponse.json({ error: "invalid parent" }, { status: 400 });
    }
    const q = sql();
    if (parentId != null) {
      const parent = (await q`
        select id from stock_location_nodes where id = ${parentId} limit 1
      `) as Array<{ id: number }>;
      if (parent.length === 0) {
        return NextResponse.json({ error: "parent not found" }, { status: 404 });
      }
    }
    const rows = (await q`
      insert into stock_location_nodes (parent_id, name)
      values (${parentId}, ${name})
      returning id, parent_id, name, created_at
    `) as Array<Record<string, unknown>>;
    return NextResponse.json({ node: rows[0] }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}

// PATCH { id, name? } rename · { id, archived } archive/unarchive ·
//       { id, parent_id } move a whole branch (children follow automatically).
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const isAdmin = canReadAll(user);
    if (!(await canManage(user.id, isAdmin))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const body = (await req.json()) as {
      id?: number;
      name?: string;
      archived?: boolean;
      parent_id?: number | null;
    };
    const id = Number(body.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const q = sql();

    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      }
      await q`update stock_location_nodes set name = ${name} where id = ${id}`;
    }

    if (typeof body.archived === "boolean") {
      if (body.archived) {
        await q`update stock_location_nodes set deleted_at = now() where id = ${id}`;
      } else {
        await q`update stock_location_nodes set deleted_at = null where id = ${id}`;
      }
    }

    if (body.parent_id !== undefined) {
      const parentId = body.parent_id == null ? null : Number(body.parent_id);
      if (parentId === id) {
        return NextResponse.json(
          { error: "a node cannot be its own parent" },
          { status: 400 },
        );
      }
      // Guard against moving a node under one of its own descendants
      // (which would orphan the branch into a cycle).
      if (parentId != null) {
        const cycle = (await q`
          with recursive sub as (
            select id from stock_location_nodes where id = ${id}
            union all
            select n.id from stock_location_nodes n join sub on n.parent_id = sub.id
          )
          select 1 as bad from sub where id = ${parentId} limit 1
        `) as Array<{ bad: number }>;
        if (cycle.length > 0) {
          return NextResponse.json(
            { error: "cannot move a node into its own branch" },
            { status: 400 },
          );
        }
      }
      await q`update stock_location_nodes set parent_id = ${parentId} where id = ${id}`;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}
