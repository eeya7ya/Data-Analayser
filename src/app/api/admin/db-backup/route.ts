import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { buildDbSnapshotZip } from "@/lib/db-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/admin/db-backup
 *
 * THE database backup. One click downloads a complete, restore-ready snapshot
 * of every table in the database as a single ZIP:
 *
 *   manifest.json        table order, columns, primary keys, content hashes
 *   data/<table>.json    every row in that table (lossless JSON)
 *   README.txt           what's inside and how to restore
 *
 * This captures the DATA — clients, projects, quotations, leads, pricing,
 * users, settings. The uploaded file blobs are NOT here; those are the
 * separate "Files backup". Feed this ZIP back through Admin → Backups →
 * "Restore from backup" to re-import it into any database (it upserts every
 * row by primary key and never deletes).
 *
 * Read-only — no row or schema state is mutated. Admin only.
 */
export async function GET() {
  try {
    await requireAdmin();
    await ensureSchema();

    const { buffer, manifest } = await buildDbSnapshotZip(sql());

    const stamp = manifest.generatedAt.replace(/[:.]/g, "-");
    const filename = `magictech-database-backup-${stamp}.zip`;

    // STREAM the zip instead of returning it buffered. A buffered response is
    // capped at ~4.5 MB on Vercel — once the database grows past that, a
    // buffered download fails with net::ERR_FAILED (exactly what a full DB
    // hit here). A streamed ReadableStream response (no Content-Length) is
    // sent in chunks and isn't subject to that cap, so large snapshots
    // download fine. The zip is already assembled in memory; we just hand it
    // out 1 MB at a time.
    const CHUNK = 1 << 20; // 1 MiB
    const bytes = new Uint8Array(buffer);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Enqueue the whole buffer in bounded chunks, then close.
        for (let off = 0; off < bytes.length; off += CHUNK) {
          controller.enqueue(bytes.subarray(off, off + CHUNK));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status =
      msg === "FORBIDDEN" ? 403 : msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
