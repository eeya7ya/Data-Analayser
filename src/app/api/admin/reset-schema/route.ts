import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { resetSchemaCache, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

/**
 * POST /api/admin/reset-schema
 *
 * Forces a full schema re-bootstrap on this lambda instance.
 *
 * Safe to call on a live database — every DDL statement uses
 * `IF NOT EXISTS` / `IF EXISTS` guards and `ON CONFLICT DO NOTHING`.
 * No quotations, folders, users or any other row data is touched.
 *
 * What it does:
 *   1. Deletes the schema-fingerprint rows from `migration_flags` so the
 *      DDL block runs again on next request (or immediately below).
 *   2. Clears the in-process promise cache so `ensureSchema()` re-fires
 *      instead of returning the stale resolved promise.
 *   3. Calls `ensureSchema()` immediately so the composite indexes and any
 *      other pending migrations are applied right now, not on the next
 *      cold start.
 */
export async function POST() {
  try {
    await requireAdmin();
    await resetSchemaCache();
    await ensureSchema();
    return NextResponse.json({
      ok: true,
      message:
        "Schema re-bootstrapped successfully. All tables and indexes verified. No data was modified.",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: (err as Error).message === "FORBIDDEN" ? 403 : 500 },
    );
  }
}
