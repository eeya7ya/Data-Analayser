import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import {
  createSignedDownloadUrl,
  deleteStorageObject,
} from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Per-file endpoints.
 *
 *   GET    /api/project-files/[id]            → minted view URL (inline)
 *   GET    /api/project-files/[id]?download=1 → minted download URL
 *   DELETE /api/project-files/[id]            → soft-delete + remove blob
 *
 * Owner-isolation is enforced for non-admins. Storage URLs are signed
 * for 5 minutes and never persisted on the client; every access mints a
 * fresh one so a leaked URL stops working quickly.
 */

async function loadFileForUser(
  q: ReturnType<typeof sql>,
  id: number,
  user: { id: number; role: string },
): Promise<{
  id: number;
  owner_id: number | null;
  filename: string;
  mime: string;
  storage_path: string;
} | null> {
  const rows = (await q`
    select id, owner_id, filename, mime, storage_path
    from project_files
    where id = ${id} and deleted_at is null
    limit 1
  `) as Array<{
    id: number;
    owner_id: number | null;
    filename: string;
    mime: string;
    storage_path: string;
  }>;
  if (rows.length === 0) return null;
  if (!canReadAll(user) && rows[0].owner_id !== user.id) return null;
  return rows[0];
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
    const file = await loadFileForUser(q, id, user);
    if (!file) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const isDownload = req.nextUrl.searchParams.get("download") === "1";
    const url = await createSignedDownloadUrl(file.storage_path, {
      // Inline view for the eyeball / iframe preview, attachment for
      // the explicit Download button. Passing the filename string
      // makes the browser save with the original user-visible name.
      download: isDownload ? file.filename : false,
    });
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
 * Body: { project_id: number }
 *
 * Re-files a file under a different project. Used by the drag-and-drop
 * "move between projects" affordance on the folder dashboard. Ownership
 * is enforced on both ends — the caller must own the file and the target
 * project — so a user can never plant a file under someone else's
 * project. Admins skip the ownership check.
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
    const body = (await req.json()) as { project_id?: number };
    const targetProjectId = Number(body?.project_id);
    if (!Number.isFinite(targetProjectId) || targetProjectId <= 0) {
      return NextResponse.json(
        { error: "project_id required" },
        { status: 400 },
      );
    }
    const q = sql();
    const file = await loadFileForUser(q, id, user);
    if (!file) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
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
    const file = await loadFileForUser(q, id, user);
    if (!file) {
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
    try {
      await deleteStorageObject(file.storage_path);
    } catch {
      // already-gone / network blip — leave the soft-deleted row in
      // place; a future sweep can reconcile orphan blobs vs rows.
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
