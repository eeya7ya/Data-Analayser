import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { hasModule } from "@/lib/modules";
import { getLinkedProjectIds } from "@/lib/projectAccess";
import {
  deleteR2ObjectForPath,
  isR2Configured,
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
 * Files live in Cloudflare R2 — every view/download is a short-lived
 * presigned R2 GET, and there is no Supabase storage dependency. Owner-
 * isolation is enforced for non-admins. Storage URLs are signed for 5
 * minutes and never persisted on the client; every access mints a fresh
 * one so a leaked URL stops working quickly.
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
 * Mint a short-lived URL the browser fetches the file from. Files live in
 * Cloudflare R2, so this presigns an R2 GET. `downloadName` forces an
 * attachment download with that name; omit it for inline viewing (the
 * eyeball / iframe preview).
 */
async function resolveDownloadUrl(
  storagePath: string,
  downloadName?: string,
): Promise<string> {
  if (!isR2Configured()) {
    throw new Error(
      "File storage (Cloudflare R2) is not configured on the server.",
    );
  }
  return r2PresignDownloadUrl(storagePath, {
    downloadFilename: downloadName,
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
 * True when the caller owns (or owns the client folder of) a project that is
 * lead-linked to the file's project — i.e. the file lives on the other side of
 * the same sales ↔ presales deal. Lets Raghad (presales) open the DWG Mosa
 * (sales) attached on their project, and vice-versa, without the file ever
 * being duplicated.
 */
async function userOwnsLinkedProject(
  q: ReturnType<typeof sql>,
  fileProjectId: number,
  userId: number,
): Promise<boolean> {
  const others = (await getLinkedProjectIds(fileProjectId)).filter(
    (id) => id !== fileProjectId,
  );
  if (others.length === 0) return false;
  const rows = (await q`
    select 1 from projects p
    join client_folders cf on cf.id = p.folder_id
    where p.id = any(${others}::int[]) and p.deleted_at is null
      and (p.owner_id = ${userId} or cf.owner_id = ${userId})
    limit 1
  `) as Array<{ "?column?": number }>;
  return rows.length > 0;
}

/**
 * Read access: admin / owner always; the sales ↔ presales counterpart on the
 * same lead always (shared file workspace); otherwise a projects-module user
 * (or an assigned member) may read it only when it's been shared to projects.
 */
async function canReadFile(
  q: ReturnType<typeof sql>,
  file: FileRecord,
  user: { id: number; role: string },
): Promise<boolean> {
  if (canReadAll(user) || file.owner_id === user.id) return true;
  if (await userOwnsLinkedProject(q, file.project_id, user.id)) return true;
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
    // Permanently remove the row (no Trash), then best-effort delete the
    // underlying object. Tolerating storage-side failures here means a
    // temporarily unreachable bucket doesn't block the user from cleaning up.
    await q`delete from project_files where id = ${id}`;
    // Best-effort blob cleanup from R2. A failure is tolerated — the row is
    // already gone, and a future sweep can reconcile orphan blobs.
    if (isR2Configured()) {
      try {
        await deleteR2ObjectForPath(file.storage_path);
      } catch {
        // already-gone / network blip
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
