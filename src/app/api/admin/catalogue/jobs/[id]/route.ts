/**
 * GET /api/admin/catalogue/jobs/[id]
 *
 * Polling endpoint for the background regenerate-descriptions job.
 * Returns `{ id, kind, status, total, done, error, updated_at }`.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface JobRow {
  id: number;
  kind: string;
  status: string;
  total: number;
  done: number;
  error: string | null;
  updated_at: string;
  created_at: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    await ensureSchema();
    const { id } = await params;
    const jobId = Number(id);
    if (!jobId) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const db = sql();
    const rows = (await db`
      select id, kind, status, total, done, error, updated_at, created_at
        from catalogue_jobs
       where id = ${jobId}
       limit 1
    `) as JobRow[];
    if (rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ job: rows[0] });
  } catch (err) {
    const msg = (err as Error).message || "error";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
