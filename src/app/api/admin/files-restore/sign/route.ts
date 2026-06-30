import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isR2Configured, r2PresignUploadUrl } from "@/lib/file-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/files-restore/sign
 *
 * Restore companion to the R2 files backup. Given a list of storage paths
 * (read from a backup's `_manifest.json`), returns a short-lived presigned R2
 * PUT URL for each, so the browser can re-upload every file's original bytes
 * straight back to its `project-files/<storagePath>` key after an R2 loss —
 * without the bytes ever transiting our server (same path normal uploads take).
 *
 * Admin only. Touches no database or storage state — presigning is pure
 * signing, so this is safe to call repeatedly.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    if (!isR2Configured()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "File storage (Cloudflare R2) is not configured on the server. " +
            "Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID and " +
            "CLOUDFLARE_R2_SECRET_ACCESS_KEY.",
        },
        { status: 503 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      storagePaths?: unknown;
    };
    const raw = Array.isArray(body.storagePaths) ? body.storagePaths : [];
    const paths = Array.from(
      new Set(
        raw
          .filter((p): p is string => typeof p === "string")
          .map((p) => p.trim())
          .filter(Boolean),
      ),
    );

    if (paths.length === 0) {
      return NextResponse.json(
        { ok: false, error: "storagePaths[] is required" },
        { status: 400 },
      );
    }
    // Backstop against an unbounded request; the browser chunks large restores.
    if (paths.length > 2000) {
      return NextResponse.json(
        { ok: false, error: "Too many paths in one request (max 2000)." },
        { status: 400 },
      );
    }

    const urls: Record<string, string> = {};
    for (const p of paths) {
      // 2-hour window so even a large restore over a slow link finishes in time.
      urls[p] = r2PresignUploadUrl(p, 7200);
    }

    return NextResponse.json({ ok: true, urls });
  } catch (err) {
    const msg = (err as Error).message;
    const status =
      msg === "FORBIDDEN" ? 403 : msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
