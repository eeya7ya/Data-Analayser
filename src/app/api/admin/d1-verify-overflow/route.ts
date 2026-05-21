import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { d1Query, isD1Configured } from "@/lib/db-d1";
import { resolveR2Overflow, isR2Configured, isR2OverflowRef } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/admin/d1-verify-overflow
 *
 * Admin-only. Finds every quotation in D1 whose `items_json` carries an
 * `__r2_overflow__` marker, fetches the real payload from R2, and reports
 * the round-trip. Used to confirm the migration's overflow references
 * actually resolve before cutting the app over to D1.
 */
export async function GET() {
  try {
    await requireAdmin();

    if (!isD1Configured()) {
      return NextResponse.json({ error: "D1 not configured" }, { status: 503 });
    }
    if (!isR2Configured()) {
      return NextResponse.json({ error: "R2 not configured" }, { status: 503 });
    }

    const found = await d1Query<{ id: number; ref: string; items_json: string }>(
      `SELECT id, ref, items_json FROM quotations
       WHERE items_json LIKE '%__r2_overflow__%'
       ORDER BY id`,
    );

    const checked = await Promise.all(
      found.results.map(async (row) => {
        try {
          const resolved = await resolveR2Overflow(row.items_json);
          const parsedMarker = JSON.parse(row.items_json) as unknown;
          const marker = isR2OverflowRef(parsedMarker) ? parsedMarker : null;
          const itemsCount = Array.isArray(resolved) ? resolved.length : null;
          const resolvedBytes =
            typeof resolved === "string"
              ? resolved.length
              : JSON.stringify(resolved).length;
          return {
            id: row.id,
            ref: row.ref,
            r2_key: marker?.key ?? null,
            original_size_bytes: marker?.original_size_bytes ?? null,
            resolved_bytes: resolvedBytes,
            items_count: itemsCount,
            ok: true as const,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { id: row.id, ref: row.ref, ok: false as const, error: msg };
        }
      }),
    );

    return NextResponse.json({
      total: checked.length,
      ok: checked.filter((c) => c.ok).length,
      failed: checked.filter((c) => !c.ok).length,
      rows: checked,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
