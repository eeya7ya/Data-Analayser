import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { d1Query, isD1Configured } from "@/lib/db-d1";
import {
  isR2Configured,
  isR2OverflowRef,
  resolveR2OverflowsInRows,
} from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/admin/d1-verify-overflow
 *
 * Admin-only. Finds every quotation in D1 whose `items_json` carries an
 * `__r2_overflow__` marker, fetches the real payload from R2 using the
 * same batched resolver the production read path will use, and reports
 * the round-trip per row.
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

    // Parse markers up front so we can report original sizes alongside the
    // resolved payload after the batched fetch.
    const markers = found.results.map((row) => {
      try {
        const parsed = JSON.parse(row.items_json) as unknown;
        return isR2OverflowRef(parsed) ? parsed : null;
      } catch {
        return null;
      }
    });

    let resolvedRows: typeof found.results;
    let batchError: string | null = null;
    try {
      resolvedRows = await resolveR2OverflowsInRows(found.results, [
        "items_json",
      ]);
    } catch (e) {
      resolvedRows = found.results;
      batchError = e instanceof Error ? e.message : String(e);
    }

    const checked = resolvedRows.map((row, i) => {
      const marker = markers[i];
      const resolved = row.items_json as unknown;
      // The resolver replaces the marker string with the parsed payload on
      // success. If it's still a string the fetch failed (batchError set).
      const ok = !batchError && typeof resolved !== "string";
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
        ok,
        error: ok ? undefined : batchError ?? "marker not resolved",
      };
    });

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
