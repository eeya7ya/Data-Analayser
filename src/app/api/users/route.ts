import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { hashPassword, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    await ensureSchema();
    const q = sql();
    const rows = (await q`
      select id, username, display_name, role, phone,
             coalesce(email, '') as email,
             coalesce(department_code, '') as department_code, created_at
      from users
      order by id asc
    `) as Array<{
      id: number;
      username: string;
      display_name: string;
      role: string;
      phone: string;
      email: string;
      department_code: string;
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
    const admin = await requireAdmin();
    await ensureSchema();
    const body = (await req.json()) as {
      username?: string;
      password?: string;
      role?: "admin" | "viewer" | "user";
      display_name?: string;
      phone?: string;
      email?: string;
      department_code?: string;
    };
    if (!body.username || !body.password) {
      return NextResponse.json(
        { error: "username and password required" },
        { status: 400 },
      );
    }
    const role: "admin" | "viewer" | "user" =
      body.role === "admin" || body.role === "viewer" ? body.role : "user";
    const displayName = body.display_name || "";
    const phone = (body.phone || "").trim();
    const email = (body.email || "").trim();
    const departmentCode = (body.department_code || "").trim().toUpperCase();
    const hash = await hashPassword(body.password);
    const q = sql();
    // New users join the creating admin's tenant (falling back to the default
    // tenant) so every account is attributed to a company from day one.
    const rows = (await q`
      insert into users (username, password_hash, role, display_name, phone, email, department_code, tenant_id)
      values (${body.username}, ${hash}, ${role}, ${displayName}, ${phone}, ${email}, ${departmentCode},
              coalesce(
                (select tenant_id from users where id = ${admin.id}),
                (select id from tenants where slug = 'magictech')
              ))
      on conflict (username) do nothing
      returning id, username, display_name, role, phone,
                coalesce(email, '') as email,
                coalesce(department_code, '') as department_code, created_at
    `) as Array<{
      id: number;
      username: string;
      display_name: string;
      role: string;
      phone: string;
      email: string;
      department_code: string;
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
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const body = (await req.json()) as {
      display_name?: string;
      role?: "admin" | "viewer" | "user";
      password?: string;
      phone?: string;
      email?: string;
      department_code?: string;
    };
    const q = sql();

    if (body.display_name !== undefined) {
      await q`update users set display_name = ${body.display_name} where id = ${id}`;
    }
    if (
      body.role === "admin" ||
      body.role === "viewer" ||
      body.role === "user"
    ) {
      await q`update users set role = ${body.role} where id = ${id}`;
    }
    if (body.password) {
      const hash = await hashPassword(body.password);
      await q`update users set password_hash = ${hash} where id = ${id}`;
    }
    if (body.phone !== undefined) {
      await q`update users set phone = ${body.phone.trim()} where id = ${id}`;
    }
    if (body.email !== undefined) {
      await q`update users set email = ${body.email.trim()} where id = ${id}`;
    }
    if (body.department_code !== undefined) {
      await q`update users set department_code = ${body.department_code.trim().toUpperCase()} where id = ${id}`;
    }

    const rows = (await q`
      select id, username, display_name, role, phone,
             coalesce(email, '') as email,
             coalesce(department_code, '') as department_code, created_at
      from users where id = ${id}
    `) as Array<{
      id: number;
      username: string;
      display_name: string;
      role: string;
      phone: string;
      email: string;
      department_code: string;
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
    await ensureSchema();
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
