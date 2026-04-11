import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Trash bin ("junction box") for client folders and quotations.
 *
 * GET  → lists soft-deleted folders and quotations owned by the caller
 *        (admins see everything). Nothing is ever auto-purged from here.
 * POST → restores a trashed folder or quotation by clearing `deleted_at`.
 *        For folders the restore can optionally cascade to the quotations
 *        that were trashed together with the folder (detected by matching
 *        their `deleted_at` to the folder's within a small window — folders
 *        soft-delete their children in the same transaction so the
 *        timestamps line up).
 */

interface RestoreBody {
  type: "folder" | "quotation";
  id: number;
  cascade?: boolean;
}

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    const q = sql();
    const folders =
      user.role === "admin"
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
      user.role === "admin"
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

    return NextResponse.json({ folders, quotations });
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
      // Cascade-restore the quotations that were soft-deleted alongside the
      // folder. We look for rows whose deleted_at is within 2 seconds of the
      // folder's to avoid restoring quotations that were trashed on their
      // own before the folder went to the bin.
      if (body.cascade !== false) {
        await q`
          update quotations
          set deleted_at = null, updated_at = now()
          where folder_id = ${body.id}
            and deleted_at is not null
            and deleted_at >= ${rows[0].deleted_at}::timestamptz - interval '2 seconds'
            and deleted_at <= ${rows[0].deleted_at}::timestamptz + interval '2 seconds'
        `;
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

    return NextResponse.json({ error: "unknown type" }, { status: 400 });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}
