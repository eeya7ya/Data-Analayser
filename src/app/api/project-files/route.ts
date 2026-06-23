import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { canAuthorQuotation, hasModule } from "@/lib/modules";
import { normalizeFileKind } from "@/lib/storage";
import { notifyPresalesOfProjectUpload } from "@/lib/leads";
import {
  getLinkedProjectIds,
  userOwnsProjectOrLinked,
} from "@/lib/projectAccess";

export const runtime = "nodejs";

/**
 * Project file metadata. The actual binary lives in Cloudflare R2;
 * this table only stores the bucket-relative `storage_path` (the R2 key is
 * `project-files/<storage_path>`).
 *
 * Two-phase upload flow used by the browser:
 *
 *   1. POST /api/project-files/sign-upload  →  presigned URL
 *      The browser sends { project_id, kind, filename, mime, size }.
 *      We validate the project, check size caps, mint a path under
 *      `<owner>/<project>/<random>-<safe-name>` and return a presigned
 *      R2 PUT URL.
 *
 *   2. PUT <signedUrl>  (browser → R2)
 *      The binary goes directly to Cloudflare R2; nothing transits
 *      this Next.js server (that's the whole point — Vercel body-size
 *      caps wouldn't allow it).
 *
 *   3. POST /api/project-files                →  register
 *      Once the PUT succeeds, the browser registers the file with us
 *      so the Files panel can list / download / delete it later.
 *
 * The split keeps secrets (service-role key) on the server while the
 * heavy bytes flow direct, and lets us authoritatively enforce
 * project-ownership and size caps before issuing the signed URL.
 */

type FileRow = {
  id: number;
  project_id: number;
  owner_id: number | null;
  /** Username of the uploader (owner_id), null if the user was deleted.
   *  Surfaced so the Files panel can show and sort/filter files by user. */
  owner_name: string | null;
  kind: string;
  filename: string;
  mime: string;
  size_bytes: number;
  storage_path: string;
  shared_to_projects: boolean;
  created_at: string;
};

/**
 * Resolve how much of a project's file list the caller may see:
 *   - "full"   → admin / project owner: every file.
 *   - "shared" → a projects-module user or an assigned member who isn't
 *                the owner: only files flagged `shared_to_projects`.
 *   - null     → no access.
 */
async function projectFileAccess(
  q: ReturnType<typeof sql>,
  projectId: number,
  user: { id: number; role: string },
): Promise<"full" | "shared" | null> {
  const rows = (await q`
    select id, owner_id from projects
    where id = ${projectId} and deleted_at is null
    limit 1
  `) as Array<{ id: number; owner_id: number | null }>;
  if (rows.length === 0) return null;
  if (canReadAll(user) || rows[0].owner_id === user.id) return "full";

  // Projects-module users (managers / engineers / technicians) see shared
  // files of any project they can reach via their module role.
  if (await hasModule(user.id, "projects")) return "shared";

  // An assigned member (even without a module role) sees shared files.
  const assigned = (await q`
    select 1 from project_assignments
    where project_id = ${projectId} and user_id = ${user.id} and deleted_at is null
    limit 1
  `) as Array<{ "?column?": number }>;
  if (assigned.length > 0) return "shared";

  return null;
}

/**
 * Resolve file access across the lead-linked workspace.
 *
 * Files + BOQ are shared between the salesperson's project and the presales
 * project of the SAME lead (see `getLinkedProjectIds`). So the caller's tier
 * is the strongest tier they hold on ANY of the linked projects, and the list
 * is drawn from all of them — Mosa sees the DWG Raghad attached, and Raghad
 * sees Mosa's, with one row apiece. The strongest tier wins so a salesperson
 * who owns their side ("full") sees the whole deal's files, not just the ones
 * explicitly flagged for the projects team.
 */
async function linkedProjectFileAccess(
  q: ReturnType<typeof sql>,
  projectId: number,
  user: { id: number; role: string },
): Promise<{ tier: "full" | "shared" | null; projectIds: number[] }> {
  const projectIds = await getLinkedProjectIds(projectId);
  if (projectIds.length === 0) {
    return { tier: await projectFileAccess(q, projectId, user), projectIds: [projectId] };
  }
  let best: "full" | "shared" | null = null;
  for (const pid of projectIds) {
    const tier = await projectFileAccess(q, pid, user);
    if (tier === "full") {
      best = "full";
      break;
    }
    if (tier === "shared") best = "shared";
  }
  return { tier: best, projectIds };
}

/**
 * GET /api/project-files?project_id=X — list files in a project (and the
 * lead-linked sibling project, so sales + presales share one file space).
 * Optional &kind=quotation|po|boq|other narrows to the matching tab.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const projectId = Number(searchParams.get("project_id"));
    if (!Number.isFinite(projectId) || projectId <= 0) {
      return NextResponse.json(
        { error: "project_id required" },
        { status: 400 },
      );
    }
    const q = sql();
    const { tier, projectIds } = await linkedProjectFileAccess(q, projectId, user);
    if (!tier) {
      return NextResponse.json({ files: [] });
    }
    const sharedOnly = tier === "shared";
    const kindParam = searchParams.get("kind");
    const rows = kindParam
      ? ((await q`
          select pf.id, pf.project_id, pf.owner_id, u.username as owner_name,
                 pf.kind, pf.filename, pf.mime, pf.size_bytes,
                 pf.storage_path, pf.shared_to_projects, pf.created_at
          from project_files pf
          left join users u on u.id = pf.owner_id
          where pf.project_id = any(${projectIds}::int[])
            and pf.kind = ${kindParam}
            and pf.deleted_at is null
            and (${sharedOnly}::boolean = false or pf.shared_to_projects = true)
          order by pf.created_at desc, pf.id desc
          limit 500
        `) as FileRow[])
      : ((await q`
          select pf.id, pf.project_id, pf.owner_id, u.username as owner_name,
                 pf.kind, pf.filename, pf.mime, pf.size_bytes,
                 pf.storage_path, pf.shared_to_projects, pf.created_at
          from project_files pf
          left join users u on u.id = pf.owner_id
          where pf.project_id = any(${projectIds}::int[])
            and pf.deleted_at is null
            and (${sharedOnly}::boolean = false or pf.shared_to_projects = true)
          order by pf.created_at desc, pf.id desc
          limit 500
        `) as FileRow[]);
    return NextResponse.json({ files: rows, access: tier });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * POST /api/project-files — register a file after the browser uploaded
 * its bytes via the signed URL. Body:
 *   { project_id, kind, filename, mime, size_bytes, storage_path }
 *
 * `storage_path` must match what we returned from /sign-upload — we
 * re-validate the prefix to make sure no caller invents an arbitrary
 * path under another user's prefix.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const body = (await req.json()) as {
      project_id?: number;
      kind?: string;
      filename?: string;
      mime?: string;
      size_bytes?: number;
      storage_path?: string;
    };
    const projectId = Number(body.project_id);
    const filename = String(body.filename || "").trim();
    const storagePath = String(body.storage_path || "").trim();
    const mime = String(body.mime || "application/octet-stream").trim();
    const size = Number(body.size_bytes ?? 0);
    if (
      !Number.isFinite(projectId) ||
      projectId <= 0 ||
      !filename ||
      !storagePath
    ) {
      return NextResponse.json(
        { error: "project_id, filename and storage_path are required" },
        { status: 400 },
      );
    }
    const q = sql();
    // Write gate: the project owner (tier "full") always; either side of a
    // lead-linked deal may also register a file into the shared workspace.
    const tier = await projectFileAccess(q, projectId, user);
    const canWrite =
      tier === "full" || (await userOwnsProjectOrLinked(projectId, user.id));
    if (!canWrite) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    // Mirrors POST /api/quotations and /sign-upload: registering a
    // quotation-kind file (an old Excel / PDF priced quote) is authoring
    // and restricted to presales / presales_manager / admin. Plain sales
    // raise an RFQ via POST /api/leads instead.
    if (normalizeFileKind(body.kind) === "quotation" && !(await canAuthorQuotation(user))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    // Belt-and-braces: the path the browser hands back must start with
    // the per-owner / per-project prefix we minted in /sign-upload.
    // Without this, a caller could register a file at someone else's
    // path. (The signed URL itself already enforces the path, but we
    // double-check at registration so a leaked URL can't subvert
    // ownership.)
    const expectedPrefix = `${user.id}/${projectId}/`;
    if (
      user.role !== "admin" &&
      !storagePath.startsWith(expectedPrefix)
    ) {
      return NextResponse.json(
        { error: "storage path mismatch" },
        { status: 400 },
      );
    }
    const rows = (await q`
      insert into project_files
        (project_id, owner_id, kind, filename, mime, size_bytes, storage_path)
      values (
        ${projectId}, ${user.id}, ${normalizeFileKind(body.kind)},
        ${filename.slice(0, 200)}, ${mime}, ${Math.max(0, Math.trunc(size))},
        ${storagePath}
      )
      returning id, project_id, owner_id, kind, filename, mime, size_bytes,
                storage_path, shared_to_projects, created_at
    `) as FileRow[];

    // Route the upload to the presales handling this project's RFQ (with a
    // presales-manager fallback). Best-effort — a notification hiccup must
    // never fail the upload the user just made.
    const fk = rows[0].kind;
    const label = fk === "boq" ? "BOQ" : fk === "po" ? "PO" : "file";
    try {
      await notifyPresalesOfProjectUpload({
        projectId,
        uploaderId: user.id,
        label,
        filename,
      });
    } catch {
      // ignore — upload already succeeded
    }

    // The bytes were uploaded straight to R2 via the presigned URL from
    // /sign-upload, so there's nothing to mirror here — the file is already
    // in its durable home.
    return NextResponse.json({ file: rows[0] });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

