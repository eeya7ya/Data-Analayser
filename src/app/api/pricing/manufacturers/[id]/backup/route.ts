export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, requireWriter } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { isPricingAdmin } from "@/lib/pricing/access";
import {
  BACKUP_FORMAT_VERSION,
  buildManufacturerBackup,
  restoreProjects,
  payloadToCsv,
  csvToPayload,
  normaliseRestoreBody,
  type BackupPayload,
} from "@/lib/pricing/backup";

type Ctx = { params: Promise<{ id: string }> };

async function ensureManufacturerAccess(
  mfgId: number,
  user: { id: number; role: string; username: string },
): Promise<
  | { ok: true; manufacturer: { id: number; name: string } }
  | { ok: false; status: number; error: string }
> {
  const q = sql();
  const mfgRows = (await q`
    select id, name from pricing_manufacturers
    where id = ${mfgId} and deleted_at is null
    limit 1
  `) as Array<{ id: number; name: string }>;
  if (mfgRows.length === 0) {
    return { ok: false, status: 404, error: "Manufacturer not found" };
  }
  if (!isPricingAdmin(user as never)) {
    const pin = (await q`
      select 1 as ok from pricing_user_manufacturers
      where user_id = ${user.id} and manufacturer_id = ${mfgId}
        and deleted_at is null
      limit 1
    `) as Array<{ ok: number }>;
    if (pin.length === 0) return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, manufacturer: mfgRows[0] };
}

function safeName(name: string) {
  return name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "backup";
}

export async function GET(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const { id } = await params;
    const mfgId = parseInt(id, 10);
    if (Number.isNaN(mfgId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const access = await ensureManufacturerAccess(mfgId, user);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const { searchParams } = new URL(req.url);
    const format = (searchParams.get("format") ?? "json").toLowerCase();
    const ownerParam = searchParams.get("ownerUserId");
    const ownerUserId =
      ownerParam != null && Number.isFinite(parseInt(ownerParam, 10))
        ? parseInt(ownerParam, 10)
        : null;
    const q = sql();
    const ownerFilter: number | "all" = isPricingAdmin(user)
      ? ownerUserId != null
        ? ownerUserId
        : "all"
      : user.id;

    const manufacturer = await buildManufacturerBackup(
      q,
      mfgId,
      access.manufacturer.name,
      ownerFilter,
    );
    const payload: BackupPayload = {
      formatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      manufacturers: [manufacturer],
    };
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `${safeName(access.manufacturer.name)}-pricing-${stamp}`;

    if (format === "csv") {
      return new NextResponse(payloadToCsv(payload), {
        status: 200,
        headers: {
          "Content-Type": "text/csv;charset=utf-8",
          "Content-Disposition": `attachment; filename="${base}.csv"`,
        },
      });
    }
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${base}.json"`,
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireWriter();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const { id } = await params;
    const mfgId = parseInt(id, 10);
    if (Number.isNaN(mfgId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const access = await ensureManufacturerAccess(mfgId, user);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const { searchParams } = new URL(req.url);
    const ownerParam = searchParams.get("ownerUserId");
    const requestedOwnerId =
      ownerParam != null && Number.isFinite(parseInt(ownerParam, 10))
        ? parseInt(ownerParam, 10)
        : null;
    const restoreOwnerId =
      isPricingAdmin(user) && requestedOwnerId != null ? requestedOwnerId : user.id;

    // Accept JSON or CSV by content-type / ?format.
    const format = (searchParams.get("format") ?? "").toLowerCase();
    const ct = req.headers.get("content-type") ?? "";
    const raw = await req.text();
    const manufacturers =
      format === "csv" || ct.includes("text/csv")
        ? csvToPayload(raw).manufacturers
        : (() => {
            const body = (() => {
              try {
                return JSON.parse(raw);
              } catch {
                return null;
              }
            })();
            return normaliseRestoreBody(body);
          })();

    if (!manufacturers) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // Restore every project from the file into THIS manufacturer.
    const q = sql();
    const stamp = new Date().toISOString().slice(0, 10);
    const suffix = ` (restored ${stamp})`;
    let restored = 0;
    let skipped = 0;
    const failures: { name: string; error: string }[] = [];
    for (const m of manufacturers) {
      const r = await restoreProjects(q, mfgId, restoreOwnerId, m.projects ?? [], suffix);
      restored += r.restored;
      skipped += r.skipped;
      failures.push(...r.failures);
    }

    return NextResponse.json({
      success: failures.length === 0,
      restored,
      skipped,
      failed: failures.length,
      failures,
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
