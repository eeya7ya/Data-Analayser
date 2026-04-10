import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUser();
    await ensureSchema();
    const q = sql();
    const rows = (await q`
      select id, name, created_at, updated_at
      from client_folders
      order by name asc
    `) as Array<{ id: number; name: string; created_at: string; updated_at: string }>;
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
    await requireUser();
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
      insert into client_folders (name)
      values (${name})
      on conflict (name) do nothing
      returning id, name, created_at, updated_at
    `) as Array<{ id: number; name: string; created_at: string; updated_at: string }>;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Folder name already exists" },
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
    await requireUser();
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
    const rows = (await q`
      update client_folders
      set name = ${name}, updated_at = now()
      where id = ${id}
      returning id, name, created_at, updated_at
    `) as Array<{ id: number; name: string; created_at: string; updated_at: string }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    return NextResponse.json({ folder: rows[0] });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: "Folder name already exists" },
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
    await requireAdmin();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const q = sql();
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
