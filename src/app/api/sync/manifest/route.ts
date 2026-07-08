import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sync/manifest
 *
 * The list of files the current member should have mirrored into their local
 * "sync folder" (see SyncFolderClient / fsSync.ts). Scoped to THEIR stuff:
 * files they uploaded, plus every file under a project or client folder they
 * own. Admins get everything.
 *
 * The binary is fetched per-file through the existing, access-checked
 * `/api/project-files/[id]` presign — this endpoint only returns metadata, so
 * a slightly generous scope here can never leak bytes the per-file guard would
 * refuse. Read-only.
 */
export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    const q = sql();
    const all = canReadAll(user);
    const rows = (await q`
      select pf.id, pf.project_id, pf.filename, pf.mime, pf.size_bytes,
             p.name as project_name, cf.name as client_name
      from project_files pf
      join projects p on p.id = pf.project_id and p.deleted_at is null
      join client_folders cf on cf.id = p.folder_id and cf.deleted_at is null
      where pf.deleted_at is null
        and (${all}::boolean = true
             or pf.owner_id = ${user.id}
             or p.owner_id = ${user.id}
             or cf.owner_id = ${user.id})
      order by cf.name asc, p.name asc, pf.filename asc
      limit 5000
    `) as Array<{
      id: number;
      project_id: number;
      filename: string;
      mime: string;
      size_bytes: number;
      project_name: string;
      client_name: string;
    }>;

    return NextResponse.json({
      files: rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        projectName: r.project_name || "Project",
        clientName: r.client_name || "Client",
        filename: r.filename,
        mime: r.mime,
        sizeBytes: Number(r.size_bytes) || 0,
      })),
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
