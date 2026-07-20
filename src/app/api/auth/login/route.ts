import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import {
  createSessionCookie,
  ensureDefaultAdmin,
  verifyPassword,
} from "@/lib/auth";

export const runtime = "nodejs";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

type Bucket = { count: number; resetAt: number };
const attempts = new Map<string, Bucket>();

function clientKey(req: NextRequest, username: string): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return `${ip}|${username.toLowerCase()}`;
}

function checkRate(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const bucket = attempts.get(key);
  if (!bucket || bucket.resetAt < now) {
    return { ok: true };
  }
  if (bucket.count >= MAX_ATTEMPTS) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true };
}

function recordFailure(key: string): void {
  const now = Date.now();
  const bucket = attempts.get(key);
  if (!bucket || bucket.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  bucket.count += 1;
}

function clearAttempts(key: string): void {
  attempts.delete(key);
}

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

    const key = clientKey(req, username);
    const gate = checkRate(key);
    if (!gate.ok) {
      return NextResponse.json(
        {
          error: `Too many attempts. Try again in ${Math.ceil(gate.retryAfterSec / 60)} minute(s).`,
        },
        { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
      );
    }

    const q = sql();
    const rows = (await q`
      select id, username, password_hash, role, display_name, phone,
             must_change_password
      from users
      where username = ${username}
      limit 1
    `) as Array<{
      id: number;
      username: string;
      password_hash: string;
      role: "admin" | "user";
      display_name: string;
      phone: string | null;
      must_change_password: boolean | number | null;
    }>;
    if (rows.length === 0) {
      recordFailure(key);
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }
    const row = rows[0];
    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) {
      recordFailure(key);
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }
    clearAttempts(key);
    const mustChangePassword = Boolean(row.must_change_password);
    await createSessionCookie({
      id: row.id,
      username: row.username,
      role: row.role,
      display_name: row.display_name || "",
      phone: row.phone || "",
      mustChangePassword,
    });
    return NextResponse.json({
      ok: true,
      user: {
        id: row.id,
        username: row.username,
        role: row.role,
        display_name: row.display_name || "",
        phone: row.phone || "",
        must_change_password: mustChangePassword,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Login failed" },
      { status: 500 },
    );
  }
}
