import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { ensureFolderProjectCoverage } from "@/lib/projects";

export const runtime = "nodejs";

/**
 * Projects sit between client folders and the things filed under them
 * (quotations, POs, BOQs, uploaded files). Every folder gets a "Default
 * Project" auto-created by the projects_foundation_v1 migration so
 * legacy quotations are never orphaned. Regular users only see / mutate
 * projects whose `owner_id` matches them; admins see everything. Soft-
 * delete via `deleted_at` mirrors quotations / folders so a "deleted"
 * project can be restored from the existing trash UI later if needed.
 */

type ProjectRow = {
  id: number;
  folder_id: number;
  owner_id: number | null;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

/**
 * GET /api/projects               → list every project the user can see
 * GET /api/projects?folder_id=X  → list projects under a single folder
 * GET /api/projects?id=Y         → single project by id (for the Designer)
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "crm");
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get("id");
    const folderIdParam = searchParams.get("folder_id");
    const q = sql();

    if (idParam) {
      const id = Number(idParam);
      if (!Number.isFinite(id) || id <= 0) {
        return NextResponse.json({ project: null });
      }
      const rows = (await q`
        select id, folder_id, owner_id, name, description, status, created_at, updated_at
        from projects
        where id = ${id} and deleted_at is null
        limit 1
      `) as ProjectRow[];
      const row = rows[0];
      if (!row) return NextResponse.json({ project: null });
      if (user.role !== "admin" && row.owner_id !== user.id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      return NextResponse.json({ project: row });
    }

    if (folderIdParam) {
      const folderId = Number(folderIdParam);
      if (!Number.isFinite(folderId) || folderId <= 0) {
        return NextResponse.json({ projects: [] });
      }
      // Heal-on-read: if the folder has no live project, auto-create a
      // Default Project and reattach any loose quotations / POs in the
      // folder so the project view never shows an empty pane next to a
      // folder that clearly has data filed under it.
      const folderRows = (await q`
        select owner_id from client_folders
        where id = ${folderId} and deleted_at is null
        limit 1
      `) as Array<{ owner_id: number | null }>;
      if (folderRows.length > 0) {
        await ensureFolderProjectCoverage({
          folderId,
          ownerId: folderRows[0].owner_id ?? user.id,
        });
      }
      // Owner-isolation pattern matches /api/folders. Admins see every
      // project under the folder regardless of owner.
      const rows =
        canReadAll(user)
          ? ((await q`
              select id, folder_id, owner_id, name, description, status, created_at, updated_at
              from projects
              where folder_id = ${folderId} and deleted_at is null
              order by name asc
            `) as ProjectRow[])
          : ((await q`
              select id, folder_id, owner_id, name, description, status, created_at, updated_at
              from projects
              where folder_id = ${folderId}
                and owner_id = ${user.id}
                and deleted_at is null
              order by name asc
            `) as ProjectRow[]);
      return NextResponse.json({ projects: rows });
    }

    const rows =
      canReadAll(user)
        ? ((await q`
            select id, folder_id, owner_id, name, description, status, created_at, updated_at
            from projects
            where deleted_at is null
            order by id desc
            limit 500
          `) as ProjectRow[])
        : ((await q`
            select id, folder_id, owner_id, name, description, status, created_at, updated_at
            from projects
            where owner_id = ${user.id}
              and deleted_at is null
            order by id desc
            limit 200
          `) as ProjectRow[]);
    return NextResponse.json({ projects: rows });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * POST /api/projects — create a new project under a folder. Body:
 *   { folder_id: number, name: string, description?: string }
 *
 * Folder ownership is enforced (non-admins can only create projects
 * under their own folders) so a malicious caller can't anchor a new
 * project to someone else's CRM record.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "crm");
    await ensureSchema();
    const body = (await req.json()) as {
      folder_id?: number;
      name?: string;
      description?: string;
      status?: string;
    };
    const folderId = Number(body.folder_id);
    const name = String(body.name || "").trim();
    if (!Number.isFinite(folderId) || folderId <= 0 || !name) {
      return NextResponse.json(
        { error: "folder_id and name are required" },
        { status: 400 },
      );
    }
    const q = sql();
    const folderRows = (await q`
      select owner_id from client_folders
      where id = ${folderId} and deleted_at is null
      limit 1
    `) as Array<{ owner_id: number | null }>;
    if (folderRows.length === 0) {
      return NextResponse.json({ error: "folder not found" }, { status: 404 });
    }
    if (user.role !== "admin" && folderRows[0].owner_id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const rows = (await q`
      insert into projects (folder_id, owner_id, name, description, status)
      values (
        ${folderId}, ${user.id}, ${name},
        ${(body.description ?? "").toString().trim() || null},
        ${(body.status ?? "open").toString().trim() || "open"}
      )
      returning id, folder_id, owner_id, name, description, status, created_at, updated_at
    `) as ProjectRow[];
    return NextResponse.json({ project: rows[0] });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/projects?id=X — rename / re-describe / change status.
 * Only the editable fields are honoured; folder_id and owner_id are
 * deliberately immutable from this endpoint (moving a project across
 * folders is a separate, future operation that would have to also
 * re-stamp every child quotation/PO).
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "crm");
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }
    const body = (await req.json()) as {
      name?: string;
      description?: string | null;
      status?: string;
    };
    const q = sql();
    const existingRows = (await q`
      select owner_id from projects where id = ${id} and deleted_at is null limit 1
    `) as Array<{ owner_id: number | null }>;
    if (existingRows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (
      user.role !== "admin" &&
      existingRows[0].owner_id !== user.id
    ) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    // Granular UPDATEs per provided field. Mirrors the
    // /api/purchase-orders PATCH style and avoids the `coalesce(${maybe
    // undefined}, col)` pattern, which the postgres driver chokes on
    // because undefined isn't a valid bind parameter.
    if (body.name !== undefined) {
      const trimmed = String(body.name).trim();
      if (!trimmed) {
        return NextResponse.json(
          { error: "name cannot be empty" },
          { status: 400 },
        );
      }
      await q`update projects set name = ${trimmed} where id = ${id}`;
    }
    if (body.description !== undefined) {
      const value =
        body.description === null
          ? null
          : String(body.description).trim() || null;
      await q`update projects set description = ${value} where id = ${id}`;
    }
    if (body.status !== undefined) {
      const value = String(body.status).trim() || "open";
      await q`update projects set status = ${value} where id = ${id}`;
    }
    await q`update projects set updated_at = now() where id = ${id}`;
    const rows = (await q`
      select id, folder_id, owner_id, name, description, status, created_at, updated_at
      from projects where id = ${id} limit 1
    `) as ProjectRow[];
    return NextResponse.json({ project: rows[0] });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/projects?id=X — soft-delete. Cascades to project_files
 * (the bucket files are kept for now; a separate cleanup job can sweep
 * objects whose project row is gone). Quotations / POs are preserved
 * with their FK set to NULL via the `on delete set null` clause.
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "crm");
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }
    const q = sql();
    const owned = (await q`
      select owner_id from projects where id = ${id} and deleted_at is null limit 1
    `) as Array<{ owner_id: number | null }>;
    if (owned.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (user.role !== "admin" && owned[0].owner_id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    await q`
      update projects set deleted_at = now(), updated_at = now()
      where id = ${id}
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
