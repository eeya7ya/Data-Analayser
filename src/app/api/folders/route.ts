import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Client folders are the CRM records: each folder is a client. It carries
 * the client's contact details (email / phone / company) so that creating a
 * new quotation from inside the folder can auto-populate those fields.
 *
 * Scope:
 *   - Regular users only see and manage the folders they own.
 *   - Admins can see (and manage) every folder across all users.
 *
 * Soft-delete: DELETE marks the folder (and every quotation inside it) with
 * a `deleted_at` timestamp instead of removing the row. Trashed items are
 * hidden from GET here and surfaced via /api/trash for restoration.
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
                   f.client_email, f.client_phone, f.client_company,
                   u.username as owner_username,
                   u.display_name as owner_display_name
            from client_folders f
            left join users u on u.id = f.owner_id
            where f.deleted_at is null
            order by u.username nulls first, f.name asc
          `) as Array<{
            id: number;
            name: string;
            owner_id: number | null;
            created_at: string;
            updated_at: string;
            client_email: string | null;
            client_phone: string | null;
            client_company: string | null;
            owner_username: string | null;
            owner_display_name: string | null;
          }>)
        : ((await q`
            select id, name, owner_id, created_at, updated_at,
                   client_email, client_phone, client_company
            from client_folders
            where owner_id = ${user.id}
              and deleted_at is null
            order by name asc
          `) as Array<{
            id: number;
            name: string;
            owner_id: number | null;
            created_at: string;
            updated_at: string;
            client_email: string | null;
            client_phone: string | null;
            client_company: string | null;
          }>);
    return NextResponse.json(
      { folders: rows },
      {
        headers: {
          "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
        },
      },
    );
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
    const body = (await req.json()) as {
      name?: string;
      client_email?: string | null;
      client_phone?: string | null;
      client_company?: string | null;
    };
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json(
        { error: "Folder name is required" },
        { status: 400 },
      );
    }
    const email = body.client_email?.trim() || null;
    const phone = body.client_phone?.trim() || null;
    const company = body.client_company?.trim() || null;
    const q = sql();
    const rows = (await q`
      insert into client_folders (name, owner_id, client_email, client_phone, client_company)
      values (${name}, ${user.id}, ${email}, ${phone}, ${company})
      on conflict (owner_id, name) do nothing
      returning id, name, owner_id, created_at, updated_at,
                client_email, client_phone, client_company
    `) as Array<{
      id: number;
      name: string;
      owner_id: number | null;
      created_at: string;
      updated_at: string;
      client_email: string | null;
      client_phone: string | null;
      client_company: string | null;
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
    const body = (await req.json()) as {
      name?: string;
      client_email?: string | null;
      client_phone?: string | null;
      client_company?: string | null;
    };
    const q = sql();
    // Verify ownership (admins can edit any folder).
    const owned = (await q`
      select id, owner_id, name, client_email, client_phone, client_company
      from client_folders
      where id = ${id} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      owner_id: number | null;
      name: string;
      client_email: string | null;
      client_phone: string | null;
      client_company: string | null;
    }>;
    if (owned.length === 0) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    if (user.role !== "admin" && owned[0].owner_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Only touch columns the caller explicitly sent so a partial update (e.g.
    // a rename-only request) can't accidentally blank the contact card.
    const name =
      body.name !== undefined ? body.name.trim() : owned[0].name;
    if (!name) {
      return NextResponse.json(
        { error: "Folder name is required" },
        { status: 400 },
      );
    }
    const email =
      body.client_email !== undefined
        ? (body.client_email?.trim() || null)
        : owned[0].client_email;
    const phone =
      body.client_phone !== undefined
        ? (body.client_phone?.trim() || null)
        : owned[0].client_phone;
    const company =
      body.client_company !== undefined
        ? (body.client_company?.trim() || null)
        : owned[0].client_company;

    const rows = (await q`
      update client_folders
      set name = ${name},
          client_email = ${email},
          client_phone = ${phone},
          client_company = ${company},
          updated_at = now()
      where id = ${id}
      returning id, name, owner_id, created_at, updated_at,
                client_email, client_phone, client_company
    `) as Array<{
      id: number;
      name: string;
      owner_id: number | null;
      created_at: string;
      updated_at: string;
      client_email: string | null;
      client_phone: string | null;
      client_company: string | null;
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
      select id, owner_id from client_folders
      where id = ${id} and deleted_at is null
      limit 1
    `) as Array<{ id: number; owner_id: number | null }>;
    if (owned.length === 0) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    if (user.role !== "admin" && owned[0].owner_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Soft delete: stamp both the folder and every quotation inside it with
    // the same deleted_at so the trash UI can group and offer a cascade
    // restore ("undo the delete").
    await q`
      update quotations
      set deleted_at = now()
      where folder_id = ${id} and deleted_at is null
    `;
    await q`
      update client_folders
      set deleted_at = now(), updated_at = now()
      where id = ${id}
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500 },
    );
  }
}
