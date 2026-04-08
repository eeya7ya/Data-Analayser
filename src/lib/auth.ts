import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { sql, ensureSchema } from "./db";

const COOKIE = "mt_session";
const ALG = "HS256";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("AUTH_SECRET missing or too short (>=16 chars).");
  }
  return new TextEncoder().encode(s);
}

export interface SessionUser {
  id: number;
  username: string;
  role: "admin" | "user";
}

/**
 * PBKDF2 password hashing using Web Crypto — runs on Edge and Node without
 * native bcrypt. Format: `pbkdf2$<iters>$<saltB64>$<hashB64>`.
 */
const ITERS = 120_000;

function b64(buf: ArrayBuffer): string {
  return Buffer.from(new Uint8Array(buf)).toString("base64");
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(s, "base64");
  // Allocate a fresh ArrayBuffer so the typed array is not backed by
  // SharedArrayBuffer (which Web Crypto rejects).
  const ab = new ArrayBuffer(buf.byteLength);
  const out = new Uint8Array(ab);
  out.set(buf);
  return out;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERS },
    key,
    256,
  );
  return `pbkdf2$${ITERS}$${b64(salt.buffer)}$${b64(bits)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iters = parseInt(parts[1], 10);
  const salt = fromB64(parts[2]);
  const expected = parts[3];
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iters },
    key,
    256,
  );
  return b64(bits) === expected;
}

/** Bootstraps the default admin user on first call. Idempotent. */
export async function ensureDefaultAdmin(): Promise<void> {
  await ensureSchema();
  const user = process.env.DEFAULT_ADMIN_USER || "admin";
  const pass = process.env.DEFAULT_ADMIN_PASS || "admin123";
  const q = sql();
  const existing = (await q`
    select id from users where username = ${user}
  `) as Array<{ id: number }>;
  if (existing.length === 0) {
    const hash = await hashPassword(pass);
    await q`
      insert into users (username, password_hash, role)
      values (${user}, ${hash}, 'admin')
    `;
  }
}

export async function createSessionCookie(user: SessionUser): Promise<void> {
  const token = await new SignJWT({
    sub: String(user.id),
    username: user.username,
    role: user.role,
  })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] });
    return {
      id: Number(payload.sub),
      username: String(payload.username),
      role: (payload.role as "admin" | "user") || "user",
    };
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("FORBIDDEN");
  return user;
}
