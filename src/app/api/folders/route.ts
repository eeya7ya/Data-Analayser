import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Folders are scoped per-user:
 *   - Regular users only see and manage the folders they own.
 *   - Admins can see (and manage) every folder across all users.
 */
export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    const q = sql();
    const rows =
      user.role === "admin"
        ? ((await q`
            select f.id, f.name, f.owner_id, f.created_at, f.updated_at,
                   u.username as owner_username,
                   u.display_name as owner_display_name
            from client_folders f
            left join users u on u.id = f.owner_id
            order by u.username nulls first, f.name asc
          `) as Array<{
            id: number;
            name: string;
            owner_id: number | null;
            created_at: string;
            updated_at: string;
            owner_username: string | null;
            owner_display_name: string | null;
          }>)
        : ((await q`
            select id, name, owner_id, created_at, updated_at
            from client_folders
            where owner_id = ${user.id}
            order by name asc
          `) as Array<{
            id: number;
            name: string;
            owner_id: number | null;
            created_at: string;
            updated_at: string;
          }>);
    return NextResponse.json({ folders: rows });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const body = (await req.json()) as { name?: string };
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json(
        { error: "Folder name is required" },
        { status: 400 },
      );
    }
    const q = sql();
    const rows = (await q`
      insert into client_folders (name, owner_id)
      values (${name}, ${user.id})
      on conflict (owner_id, name) do nothing
      returning id, name, owner_id, created_at, updated_at
    `) as Array<{
      id: number;
      name: string;
      owner_id: number | null;
      created_at: string;
      updated_at: string;
    }>;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "You already have a folder with that name" },
        { status: 409 },
      );
    }
    return NextResponse.json({ folder: rows[0] });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const body = (await req.json()) as { name?: string };
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json(
        { error: "Folder name is required" },
        { status: 400 },
      );
    }
    const q = sql();
    // Verify ownership (admins can rename any folder).
    const owned = (await q`
      select id, owner_id from client_folders where id = ${id} limit 1
    `) as Array<{ id: number; owner_id: number | null }>;
    if (owned.length === 0) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    if (user.role !== "admin" && owned[0].owner_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const rows = (await q`
      update client_folders
      set name = ${name}, updated_at = now()
      where id = ${id}
      returning id, name, owner_id, created_at, updated_at
    `) as Array<{
      id: number;
      name: string;
      owner_id: number | null;
      created_at: string;
      updated_at: string;
    }>;
    return NextResponse.json({ folder: rows[0] });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: "You already have a folder with that name" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const q = sql();
    // Verify ownership (admins can delete any folder).
    const owned = (await q`
      select id, owner_id from client_folders where id = ${id} limit 1
    `) as Array<{ id: number; owner_id: number | null }>;
    if (owned.length === 0) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    if (user.role !== "admin" && owned[0].owner_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await q`delete from client_folders where id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500 },
    );
  }
}
