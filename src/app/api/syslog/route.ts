import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Syslog — lightweight click telemetry.
 *
 *   POST   /api/syslog   body { events: [{ path, label, tag, t }] }
 *            → any signed-in user's browser batches clicks here (sendBeacon).
 *   GET    /api/syslog   → admin only; the most recent click events.
 *   DELETE /api/syslog   → admin only; clear the whole log.
 *
 * Rows auto-expire after one week: every read/most writes (and the daily
 * backup cron) purge anything older than RETENTION_DAYS, so the table never
 * grows without bound and nothing has to be cleaned up by hand.
 *
 * The table is created lazily (CREATE TABLE IF NOT EXISTS) so the feature works
 * on D1 even before the canonical schema (d1/schema.sql) is re-applied.
 */

const RETENTION_DAYS = 7;
const MAX_BATCH = 16; // keeps the multi-row insert under D1's ~100-param limit

type SqlClient = ReturnType<typeof sql>;

const globalForClickLog = globalThis as unknown as { __clickLogReady?: boolean };

async function ensureClickLog(q: SqlClient): Promise<void> {
  if (globalForClickLog.__clickLogReady) return;
  await q`
    create table if not exists click_log (
      id         integer primary key,
      user_id    integer,
      username   text,
      path       text not null,
      label      text,
      tag        text,
      created_at text not null
    )
  `;
  globalForClickLog.__clickLogReady = true;
}

function cutoffIso(): string {
  return new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
}

async function purge(q: SqlClient): Promise<void> {
  await q`delete from click_log where created_at < ${cutoffIso()}`;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ ok: false }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as {
      events?: Array<{ path?: unknown; label?: unknown; tag?: unknown; t?: unknown }>;
    };
    const events = Array.isArray(body?.events) ? body.events.slice(0, MAX_BATCH) : [];
    if (events.length === 0) return NextResponse.json({ ok: true, stored: 0 });

    const q = sql();
    await ensureClickLog(q);

    const now = new Date().toISOString();
    const params: Array<string | number | null> = [];
    for (const ev of events) {
      const t = typeof ev?.t === "string" ? ev.t.slice(0, 40) : now;
      params.push(
        user.id,
        user.username,
        String(ev?.path ?? "").slice(0, 300),
        String(ev?.label ?? "").slice(0, 200),
        String(ev?.tag ?? "").slice(0, 40),
        t,
      );
    }
    const rowSql = events.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
    await q.unsafe(
      `insert into click_log (user_id, username, path, label, tag, created_at) values ${rowSql}`,
      params,
    );

    // Opportunistic purge so the table self-trims even without an admin viewing.
    if (Math.random() < 0.05) await purge(q).catch(() => {});

    return NextResponse.json({ ok: true, stored: events.length });
  } catch {
    // Telemetry is best-effort — never surface an error to the page.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

export async function GET() {
  try {
    await requireAdmin();
    const q = sql();
    await ensureClickLog(q);
    await purge(q).catch(() => {});
    const events = (await q`
      select id, user_id, username, path, label, tag, created_at
      from click_log
      order by created_at desc, id desc
      limit 500
    `) as Array<Record<string, unknown>>;
    return NextResponse.json({ events, retentionDays: RETENTION_DAYS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "FORBIDDEN" ? 403 : msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE() {
  try {
    await requireAdmin();
    const q = sql();
    await ensureClickLog(q);
    await q`delete from click_log`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "FORBIDDEN" ? 403 : msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
