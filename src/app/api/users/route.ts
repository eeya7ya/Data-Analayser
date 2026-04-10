import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { hashPassword, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    const q = sql();
    const rows = (await q`
      select id, username, display_name, role, created_at
      from users
      order by id asc
    `) as Array<{
      id: number;
      username: string;
      display_name: string;
      role: string;
      created_at: string;
    }>;
    return NextResponse.json({ users: rows });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 403 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json()) as {
      username?: string;
      password?: string;
      role?: "admin" | "user";
      display_name?: string;
    };
    if (!body.username || !body.password) {
      return NextResponse.json(
        { error: "username and password required" },
        { status: 400 },
      );
    }
    const role: "admin" | "user" = body.role === "admin" ? "admin" : "user";
    const displayName = body.display_name || "";
    const hash = await hashPassword(body.password);
    const q = sql();
    const rows = (await q`
      insert into users (username, password_hash, role, display_name)
      values (${body.username}, ${hash}, ${role}, ${displayName})
      on conflict (username) do nothing
      returning id, username, display_name, role, created_at
    `) as Array<{
      id: number;
      username: string;
      display_name: string;
      role: string;
      created_at: string;
    }>;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Username already exists" },
        { status: 409 },
      );
    }
    return NextResponse.json({ user: rows[0] });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 403 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const body = (await req.json()) as {
      display_name?: string;
      role?: "admin" | "user";
      password?: string;
    };
    const q = sql();

    if (body.display_name !== undefined) {
      await q`update users set display_name = ${body.display_name} where id = ${id}`;
    }
    if (body.role === "admin" || body.role === "user") {
      await q`update users set role = ${body.role} where id = ${id}`;
    }
    if (body.password) {
      const hash = await hashPassword(body.password);
      await q`update users set password_hash = ${hash} where id = ${id}`;
    }

    const rows = (await q`
      select id, username, display_name, role, created_at
      from users where id = ${id}
    `) as Array<{
      id: number;
      username: string;
      display_name: string;
      role: string;
      created_at: string;
    }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "user not found" }, { status: 404 });
    }
    return NextResponse.json({ user: rows[0] });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 403 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const q = sql();
    await q`delete from users where id = ${id} and role <> 'admin'`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 403 },
    );
  }
}
