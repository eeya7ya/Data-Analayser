import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import {
  createSessionCookie,
  ensureDefaultAdmin,
  verifyPassword,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await ensureDefaultAdmin();
    const { username, password } = (await req.json()) as {
      username?: string;
      password?: string;
    };
    if (!username || !password) {
      return NextResponse.json(
        { error: "Missing credentials" },
        { status: 400 },
      );
    }
    const q = sql();
    const rows = (await q`
      select id, username, password_hash, role, display_name
      from users
      where username = ${username}
      limit 1
    `) as Array<{
      id: number;
      username: string;
      password_hash: string;
      role: "admin" | "user";
      display_name: string;
    }>;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }
    const row = rows[0];
    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }
    await createSessionCookie({
      id: row.id,
      username: row.username,
      role: row.role,
      display_name: row.display_name || "",
    });
    return NextResponse.json({
      ok: true,
      user: { id: row.id, username: row.username, role: row.role, display_name: row.display_name || "" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Login failed" },
      { status: 500 },
    );
  }
}
