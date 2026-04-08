import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { hashPassword, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    const q = sql();
    const rows = (await q`
      select id, username, role, created_at
      from users
      order by id asc
    `) as Array<{
      id: number;
      username: string;
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
    };
    if (!body.username || !body.password) {
      return NextResponse.json(
        { error: "username and password required" },
        { status: 400 },
      );
    }
    const role: "admin" | "user" = body.role === "admin" ? "admin" : "user";
    const hash = await hashPassword(body.password);
    const q = sql();
    const rows = (await q`
      insert into users (username, password_hash, role)
      values (${body.username}, ${hash}, ${role})
      on conflict (username) do nothing
      returning id, username, role, created_at
    `) as Array<{
      id: number;
      username: string;
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
