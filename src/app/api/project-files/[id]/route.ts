import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { hasModule } from "@/lib/modules";
import {
  createSignedDownloadUrl,
  deleteStorageObject,
} from "@/lib/storage";
import {
  deleteR2ObjectForPath,
  isR2Configured,
  r2ObjectExistsForPath,
  r2PresignDownloadUrl,
} from "@/lib/file-backup";

export const runtime = "nodejs";

/**
 * Per-file endpoints.
 *
 *   GET    /api/project-files/[id]            → minted view URL (inline)
 *   GET    /api/project-files/[id]?download=1 → minted download URL
 *   DELETE /api/project-files/[id]            → soft-delete + remove blob
 *
 * Files live in Cloudflare R2 (presigned GET to view/download), with a
 * Supabase signed-URL fallback for any blob that predates the R2 cutover.
 * Owner-isolation is enforced for non-admins. Storage URLs are signed
 * for 5 minutes and never persisted on the client; every access mints a
 * fresh one so a leaked URL stops working quickly.
 */

interface FileRecord {
  id: number;
  owner_id: number | null;
  project_id: number;
  filename: string;
  mime: string;
  storage_path: string;
  shared_to_projects: boolean;
}

/**
 * Mint a short-lived URL the browser fetches the file from. R2 is the primary
 * store for uploads, so we presign an R2 GET when the object is there and fall
 * back to a Supabase signed URL for any file that predates the R2 cutover and
 * isn't mirrored. `downloadName` forces an attachment download with that name;
 * omit it for inline viewing (the eyeball / iframe preview).
 */
async function resolveDownloadUrl(
  storagePath: string,
  downloadName?: string,
): Promise<string> {
  if (isR2Configured()) {
    try {
      if (await r2ObjectExistsForPath(storagePath)) {
        return r2PresignDownloadUrl(storagePath, {
          downloadFilename: downloadName,
        });
      }
    } catch {
      // R2 hiccup — fall through to the Supabase copy below.
    }
  }
  return createSignedDownloadUrl(storagePath, {
    download: downloadName ?? false,
  });
}

async function loadFileRow(
  q: ReturnType<typeof sql>,
  id: number,
): Promise<FileRecord | null> {
  const rows = (await q`
    select id, owner_id, project_id, filename, mime, storage_path, shared_to_projects
    from project_files
    where id = ${id} and deleted_at is null
    limit 1
  `) as FileRecord[];
  return rows[0] ?? null;
}

/**
 * Read access: admin / owner always; otherwise a projects-module user (or
 * an assigned member) may read it only when it's been shared to projects.
 */
async function canReadFile(
  q: ReturnType<typeof sql>,
  file: FileRecord,
  user: { id: number; role: string },
): Promise<boolean> {
  if (canReadAll(user) || file.owner_id === user.id) return true;
  if (!file.shared_to_projects) return false;
  if (await hasModule(user.id, "projects")) return true;
  const assigned = (await q`
    select 1 from project_assignments
    where project_id = ${file.project_id} and user_id = ${user.id}
      and deleted_at is null
    limit 1
  `) as Array<{ "?column?": number }>;
  return assigned.length > 0;
}

/**
 * Manage access (toggle share / move / delete): admin, the file owner, or
 * the owner of the client folder the project lives under (the sales /
 * presales person who controls this client's records).
 */
async function canManageFile(
  q: ReturnType<typeof sql>,
  file: FileRecord,
  user: { id: number; role: string },
): Promise<boolean> {
  if (canReadAll(user) || file.owner_id === user.id) return true;
  const rows = (await q`
    select cf.owner_id from projects p
    join client_folders cf on cf.id = p.folder_id
    where p.id = ${file.project_id}
    limit 1
  `) as Array<{ owner_id: number | null }>;
  return rows.length > 0 && rows[0].owner_id === user.id;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { id: idParam } = await ctx.params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const q = sql();
    const file = await loadFileRow(q, id);
    if (!file || !(await canReadFile(q, file, user))) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const isDownload = req.nextUrl.searchParams.get("download") === "1";
    // Inline view for the eyeball / iframe preview, attachment for the
    // explicit Download button (the filename makes the browser save with
    // the original user-visible name).
    const url = await resolveDownloadUrl(
      file.storage_path,
      isDownload ? file.filename : undefined,
    );
    return NextResponse.json({ url, filename: file.filename, mime: file.mime });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/project-files/[id]
 *
 * Two operations, chosen by the body:
 *   { shared_to_projects: boolean } → flip the "visible to projects" flag
 *       so projects-module users (engineers / PMs) can read this BOQ /
 *       attachment. Allowed for admin, the file owner, or the client
 *       folder owner (the sales / presales person who controls the
 *       client's records).
 *   { project_id: number } → re-file under a different project (drag-drop
 *       "move between projects"). Requires the caller to manage the file
 *       AND own the target project.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { id: idParam } = await ctx.params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const body = (await req.json()) as {
      project_id?: number;
      shared_to_projects?: boolean;
    };
    const q = sql();
    const file = await loadFileRow(q, id);
    if (!file) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (!(await canManageFile(q, file, user))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // Share toggle.
    if (typeof body.shared_to_projects === "boolean") {
      await q`
        update project_files
        set shared_to_projects = ${body.shared_to_projects}
        where id = ${id}
      `;
      await q`
        insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
        values (${user.id}, 'project_file', ${id},
                ${body.shared_to_projects ? "share_to_projects" : "unshare_from_projects"},
                '{}'::jsonb)
      `;
      return NextResponse.json({
        ok: true,
        shared_to_projects: body.shared_to_projects,
      });
    }

    // Move between projects.
    const targetProjectId = Number(body?.project_id);
    if (!Number.isFinite(targetProjectId) || targetProjectId <= 0) {
      return NextResponse.json(
        { error: "project_id or shared_to_projects required" },
        { status: 400 },
      );
    }
    const projectRows = (await q`
      select owner_id from projects
      where id = ${targetProjectId} and deleted_at is null
      limit 1
    `) as Array<{ owner_id: number | null }>;
    if (projectRows.length === 0) {
      return NextResponse.json(
        { error: "project not found" },
        { status: 404 },
      );
    }
    if (user.role !== "admin" && projectRows[0].owner_id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    await q`
      update project_files
      set project_id = ${targetProjectId}
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

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { id: idParam } = await ctx.params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const q = sql();
    const file = await loadFileRow(q, id);
    if (!file || !(await canManageFile(q, file, user))) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    // Soft-delete the row first so the UI can stop showing it
    // immediately, then best-effort delete the underlying object.
    // Tolerating storage-side failures here means a temporarily
    // unreachable bucket doesn't block the user from cleaning up.
    await q`
      update project_files
      set deleted_at = now()
      where id = ${id}
    `;
    // Best-effort blob cleanup from both stores: R2 (primary) and Supabase
    // (legacy copy / read-fallback). A failure on either is tolerated — the
    // row is already soft-deleted, and a future sweep can reconcile orphan
    // blobs vs rows.
    if (isR2Configured()) {
      try {
        await deleteR2ObjectForPath(file.storage_path);
      } catch {
        // already-gone / network blip
      }
    }
    try {
      await deleteStorageObject(file.storage_path);
    } catch {
      // already-gone / network blip
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
