import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canAuthorQuotation } from "@/lib/modules";
import { userOwnsProjectOrLinked } from "@/lib/projectAccess";
import {
  buildStoragePath,
  maxBytesForMime,
  normalizeFileKind,
} from "@/lib/storage";
import { isR2Configured, r2PresignUploadUrl } from "@/lib/file-backup";

export const runtime = "nodejs";

/**
 * POST /api/project-files/sign-upload
 *
 * Two-phase upload, phase one. The browser asks us for a presigned URL it
 * can PUT a file directly to in Cloudflare R2. We:
 *
 *   - confirm the project exists and belongs to the caller,
 *   - reject the request if the declared file size exceeds our
 *     per-MIME cap (so a 50 MB PDF is refused before the round-trip
 *     consumes egress),
 *   - mint a path under `<owner>/<project>/<random>-<safe-filename>`
 *     and presign a short-lived R2 PUT URL for it.
 *
 * The browser then PUTs the file straight to the presigned URL and on
 * success calls POST /api/project-files to register the metadata.
 *
 * Browser→R2 is cross-origin, so the R2 bucket needs a CORS policy that
 * allows the app origin with PUT/GET/HEAD.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    if (!isR2Configured()) {
      return NextResponse.json(
        {
          error:
            "File storage (Cloudflare R2) is not configured on the server. " +
            "Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID and " +
            "CLOUDFLARE_R2_SECRET_ACCESS_KEY.",
        },
        { status: 503 },
      );
    }
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
    // Mirrors POST /api/quotations: only presales / presales_manager / admin
    // may bring a priced quotation into the project (designed in-app OR
    // uploaded as an old Excel/PDF). Plain sales raise an RFQ instead.
    if (normalizeFileKind(body.kind) === "quotation" && !(await canAuthorQuotation(user))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const cap = maxBytesForMime(mime, filename);
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
    // The project owner uploads to their own project; either side of a
    // lead-linked deal (sales ↔ presales) may also contribute to the shared
    // workspace — so a salesperson can attach the client's PO / a DWG to the
    // deal even though the quotation lives under the presales project.
    if (
      user.role !== "admin" &&
      projectRows[0].owner_id !== user.id &&
      !(await userOwnsProjectOrLinked(projectId, user.id))
    ) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const storagePath = buildStoragePath({
      ownerId: user.id,
      projectId,
      filename,
    });
    // Presigned R2 PUT URL — the browser uploads the bytes straight to R2.
    // `signedUrl` keeps its name so the client's PUT-the-file-here flow is
    // unchanged; only the destination moved from Supabase to R2.
    const signedUrl = r2PresignUploadUrl(storagePath);

    return NextResponse.json({
      signedUrl,
      storage_path: storagePath,
      kind: normalizeFileKind(body.kind),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
