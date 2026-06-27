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
 *   all.json             { <table>: rows[] } convenience roll-up
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

    // Stream the snapshot in chunks rather than returning it as one buffered
    // body. Vercel caps a buffered serverless response at ~4.5 MB; a large
    // database would exceed that and drop the connection. A chunked/streamed
    // response (no Content-Length) isn't subject to that cap.
    const body = bufferToStream(buffer);
    return new NextResponse(body, {
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

/** Chunk a Buffer into a web ReadableStream so the response is sent chunked. */
function bufferToStream(buffer: Buffer, chunkSize = 1 << 20): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= buffer.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, buffer.byteLength);
      controller.enqueue(new Uint8Array(buffer.subarray(offset, end)));
      offset = end;
    },
  });
}
