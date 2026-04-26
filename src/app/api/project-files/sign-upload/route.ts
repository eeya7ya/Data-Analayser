import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  buildStoragePath,
  createSignedUploadUrl,
  maxBytesForMime,
  normalizeFileKind,
} from "@/lib/storage";

export const runtime = "nodejs";

/**
 * POST /api/project-files/sign-upload
 *
 * Two-phase upload, phase one. The browser asks us for a signed URL it
 * can PUT a file directly to in Supabase Storage. We:
 *
 *   - confirm the project exists and belongs to the caller,
 *   - reject the request if the declared file size exceeds our
 *     per-MIME cap (so a 50 MB PDF is refused before the round-trip
 *     consumes Storage egress),
 *   - mint a path under `<owner>/<project>/<random>-<safe-filename>`
 *     and ask Supabase to issue a single-use upload URL for it.
 *
 * The browser then PUTs the file straight to the signed URL and on
 * success calls POST /api/project-files to register the metadata.
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
    };
    const projectId = Number(body.project_id);
    const filename = String(body.filename || "").trim();
    const mime = String(body.mime || "application/octet-stream").trim();
    const size = Number(body.size_bytes ?? 0);
    if (
      !Number.isFinite(projectId) ||
      projectId <= 0 ||
      !filename ||
      !Number.isFinite(size) ||
      size <= 0
    ) {
      return NextResponse.json(
        { error: "project_id, filename and size_bytes are required" },
        { status: 400 },
      );
    }
    const cap = maxBytesForMime(mime);
    if (size > cap) {
      return NextResponse.json(
        {
          error: `File is too large (${(size / 1024 / 1024).toFixed(1)} MB). Max allowed for this type is ${(cap / 1024 / 1024).toFixed(0)} MB.`,
        },
        { status: 413 },
      );
    }
    const q = sql();
    const projectRows = (await q`
      select id, owner_id from projects
      where id = ${projectId} and deleted_at is null
      limit 1
    `) as Array<{ id: number; owner_id: number | null }>;
    if (projectRows.length === 0) {
      return NextResponse.json(
        { error: "project not found" },
        { status: 404 },
      );
    }
    if (
      user.role !== "admin" &&
      projectRows[0].owner_id !== user.id
    ) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const storagePath = buildStoragePath({
      ownerId: user.id,
      projectId,
      filename,
    });
    const signed = await createSignedUploadUrl(storagePath);

    return NextResponse.json({
      signedUrl: signed.signedUrl,
      token: signed.token,
      storage_path: signed.path,
      kind: normalizeFileKind(body.kind),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
