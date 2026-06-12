import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { cascadeRestoreFolder, cascadeRestoreCompany } from "@/lib/cascade";

export const runtime = "nodejs";

/**
 * Trash bin ("junction box") for client folders, quotations, and companies.
 *
 * GET  → lists soft-deleted folders, quotations, and companies owned by
 *        the caller (admins see everything). Nothing is ever auto-purged.
 * POST → restores a trashed folder, quotation, or company by clearing
 *        `deleted_at`. For folders the restore can optionally cascade to
 *        the quotations that were trashed together with the folder
 *        (detected by matching their `deleted_at` to the folder's within
 *        a small window — folders soft-delete their children in the same
 *        transaction so the timestamps line up).
 */

interface RestoreBody {
  type: "folder" | "quotation" | "company";
  id: number;
  cascade?: boolean;
}

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    const q = sql();
    const folders =
      canReadAll(user)
        ? ((await q`
            select f.id, f.name, f.owner_id, f.created_at, f.updated_at,
                   f.deleted_at, f.client_email, f.client_phone, f.client_company,
                   u.username as owner_username,
                   u.display_name as owner_display_name
            from client_folders f
            left join users u on u.id = f.owner_id
            where f.deleted_at is not null
            order by f.deleted_at desc
          `) as Array<Record<string, unknown>>)
        : ((await q`
            select id, name, owner_id, created_at, updated_at, deleted_at,
                   client_email, client_phone, client_company
            from client_folders
            where owner_id = ${user.id} and deleted_at is not null
            order by deleted_at desc
          `) as Array<Record<string, unknown>>);

    const quotations =
      canReadAll(user)
        ? ((await q`
            select q.id, q.ref, q.project_name, q.client_name, q.site_name,
                   q.folder_id, q.owner_id, q.created_at, q.updated_at,
                   q.deleted_at,
                   u.username as owner_username,
                   u.display_name as owner_display_name
            from quotations q
            left join users u on u.id = q.owner_id
            where q.deleted_at is not null
            order by q.deleted_at desc
          `) as Array<Record<string, unknown>>)
        : ((await q`
            select id, ref, project_name, client_name, site_name,
                   folder_id, owner_id, created_at, updated_at, deleted_at
            from quotations
            where owner_id = ${user.id} and deleted_at is not null
            order by deleted_at desc
          `) as Array<Record<string, unknown>>);

    const companies =
      canReadAll(user)
        ? ((await q`
            select c.id, c.name, c.website, c.industry, c.owner_id,
                   c.created_at, c.updated_at, c.deleted_at,
                   u.username as owner_username,
                   u.display_name as owner_display_name
            from companies c
            left join users u on u.id = c.owner_id
            where c.deleted_at is not null
            order by c.deleted_at desc
          `) as Array<Record<string, unknown>>)
        : ((await q`
            select id, name, website, industry, owner_id,
                   created_at, updated_at, deleted_at
            from companies
            where owner_id = ${user.id} and deleted_at is not null
            order by deleted_at desc
          `) as Array<Record<string, unknown>>);

    return NextResponse.json({ folders, quotations, companies });
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
    const body = (await req.json()) as RestoreBody;
    if (!body || !body.type || !body.id) {
      return NextResponse.json({ error: "type and id required" }, { status: 400 });
    }
    const q = sql();
    if (body.type === "folder") {
      const rows = (await q`
        select id, owner_id, name, deleted_at
        from client_folders
        where id = ${body.id} and deleted_at is not null
        limit 1
      `) as Array<{
        id: number;
        owner_id: number | null;
        name: string;
        deleted_at: string;
      }>;
      if (rows.length === 0) {
        return NextResponse.json({ error: "folder not in trash" }, { status: 404 });
      }
      if (user.role !== "admin" && rows[0].owner_id !== user.id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      // Block restoring a folder whose name collides with an existing
      // active folder for the same owner — the unique constraint would
      // reject the row and leave the trash UI in a confusing state.
      const clash = (await q`
        select 1 from client_folders
        where owner_id = ${rows[0].owner_id}
          and lower(name) = lower(${rows[0].name})
          and deleted_at is null
          and id <> ${rows[0].id}
        limit 1
      `) as Array<{ ["?column?"]: number }>;
      if (clash.length > 0) {
        return NextResponse.json(
          {
            error:
              "A folder with this name already exists. Rename the existing folder before restoring.",
          },
          { status: 409 },
        );
      }
      await q`
        update client_folders
        set deleted_at = null, updated_at = now()
        where id = ${body.id}
      `;
      // Cascade-restore the whole subtree (projects, quotations, leads,
      // POs, files) that was soft-deleted alongside the folder, matched on
      // a ±2s window around the folder's timestamp so rows trashed on their
      // own beforehand aren't resurrected.
      if (body.cascade !== false && rows[0].deleted_at) {
        await cascadeRestoreFolder(q, body.id, rows[0].deleted_at);
      }
      return NextResponse.json({ ok: true });
    }

    if (body.type === "quotation") {
      const rows = (await q`
        select q.id, q.owner_id, q.folder_id, cf.deleted_at as folder_deleted_at
        from quotations q
        left join client_folders cf on cf.id = q.folder_id
        where q.id = ${body.id} and q.deleted_at is not null
        limit 1
      `) as Array<{
        id: number;
        owner_id: number | null;
        folder_id: number | null;
        folder_deleted_at: string | null;
      }>;
      if (rows.length === 0) {
        return NextResponse.json({ error: "quotation not in trash" }, { status: 404 });
      }
      if (user.role !== "admin" && rows[0].owner_id !== user.id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      // If the parent folder is still trashed, unlink the quotation so it
      // lands in "Unfiled" after restoration — otherwise it would be
      // invisible (trash filter hides folder_id rows whose folder is gone).
      const newFolderId =
        rows[0].folder_deleted_at !== null ? null : rows[0].folder_id;
      await q`
        update quotations
        set deleted_at = null,
            folder_id  = ${newFolderId},
            updated_at = now()
        where id = ${body.id}
      `;
      return NextResponse.json({ ok: true });
    }

    if (body.type === "company") {
      const rows = (await q`
        select id, owner_id, name, deleted_at
        from companies
        where id = ${body.id} and deleted_at is not null
        limit 1
      `) as Array<{
        id: number;
        owner_id: number | null;
        name: string;
        deleted_at: string | null;
      }>;
      if (rows.length === 0) {
        return NextResponse.json({ error: "company not in trash" }, { status: 404 });
      }
      if (user.role !== "admin" && rows[0].owner_id !== user.id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      // Re-light the subtree that went down with the company first, then
      // clear the company's own stamp.
      if (body.cascade !== false && rows[0].deleted_at) {
        await cascadeRestoreCompany(q, body.id, rows[0].deleted_at);
      }
      await q`
        update companies
        set deleted_at = null, updated_at = now()
        where id = ${body.id}
      `;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "unknown type" }, { status: 400 });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}

/**
 * Permanent delete ("Delete forever") for an item already sitting in the
 * Trash. This is irreversible. We deliberately require the row to be
 * soft-deleted first (deleted_at is not null) so nothing can be purged
 * straight from an active list without passing through the Trash.
 *
 * Referential integrity is handled by the schema's FK delete rules:
 *   • companies            → folders/quotations/contacts get company_id SET NULL
 *   • client_folders       → projects CASCADE (and their files/assignments/
 *                            reports), quotations get folder_id SET NULL — so
 *                            we explicitly purge the folder's quotations too.
 *   • quotations           → change_requests / stock_checks CASCADE
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");
    const id = Number(searchParams.get("id"));
    if (!type || !Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "type and id required" }, { status: 400 });
    }
    const q = sql();
    const isAdmin = canReadAll(user);

    if (type === "company") {
      const rows = (await q`
        select owner_id from companies where id = ${id} and deleted_at is not null limit 1
      `) as Array<{ owner_id: number | null }>;
      if (rows.length === 0) {
        return NextResponse.json({ error: "company not in trash" }, { status: 404 });
      }
      if (!isAdmin && rows[0].owner_id !== user.id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      // Remove the company's client folders too. The FK only NULLs their
      // company_id, which would leave orphaned 'company'-kind folders behind
      // (they then show as "client folders" under "0 companies"). Purge each
      // folder's quotations first — folder→quotation is SET NULL and would
      // otherwise strand them — then the folders (projects/files/assignments
      // cascade via their own FKs), then the company itself.
      await q`
        delete from quotations
        where folder_id in (select id from client_folders where company_id = ${id})
      `;
      await q`delete from client_folders where company_id = ${id}`;
      await q`delete from companies where id = ${id}`;
      return NextResponse.json({ ok: true });
    }

    if (type === "folder") {
      const rows = (await q`
        select owner_id from client_folders where id = ${id} and deleted_at is not null limit 1
      `) as Array<{ owner_id: number | null }>;
      if (rows.length === 0) {
        return NextResponse.json({ error: "folder not in trash" }, { status: 404 });
      }
      if (!isAdmin && rows[0].owner_id !== user.id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      // Purge the quotations belonging to this client too — otherwise the
      // FK would only null their folder_id and leave them stranded in Trash.
      await q`delete from quotations where folder_id = ${id}`;
      await q`delete from client_folders where id = ${id}`;
      return NextResponse.json({ ok: true });
    }

    if (type === "quotation") {
      const rows = (await q`
        select owner_id from quotations where id = ${id} and deleted_at is not null limit 1
      `) as Array<{ owner_id: number | null }>;
      if (rows.length === 0) {
        return NextResponse.json({ error: "quotation not in trash" }, { status: 404 });
      }
      if (!isAdmin && rows[0].owner_id !== user.id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      await q`delete from quotations where id = ${id}`;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "unknown type" }, { status: 400 });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}
