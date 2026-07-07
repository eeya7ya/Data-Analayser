export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, requireWriter } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { DEFAULT_USER_COLOR, isPricingAdmin } from "@/lib/pricing/access";
import {
  BACKUP_FORMAT_VERSION,
  buildManufacturerBackup,
  restoreProjects,
  payloadToCsv,
  csvToPayload,
  normaliseRestoreBody,
  type BackupPayload,
  type BackupManufacturer,
} from "@/lib/pricing/backup";

/**
 * Whole-workspace pricing backup / restore — every manufacturer the caller can
 * see, in one JSON or CSV file. Admins get every manufacturer; a regular user
 * gets the ones they've pinned (and their own projects).
 */

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const q = sql();
    const admin = isPricingAdmin(user);

    const mfgRows = admin
      ? ((await q`
          select id, name from pricing_manufacturers
          where deleted_at is null order by name asc
        `) as Array<{ id: number; name: string }>)
      : ((await q`
          select m.id, m.name
          from pricing_user_manufacturers um
          join pricing_manufacturers m on m.id = um.manufacturer_id
          where um.user_id = ${user.id} and um.deleted_at is null
            and m.deleted_at is null
          order by m.name asc
        `) as Array<{ id: number; name: string }>);

    const manufacturers: BackupManufacturer[] = [];
    for (const m of mfgRows) {
      manufacturers.push(
        await buildManufacturerBackup(q, m.id, m.name, admin ? "all" : user.id),
      );
    }

    const payload: BackupPayload = {
      formatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      manufacturers,
    };
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `all-manufacturers-pricing-${stamp}`;
    const format = (new URL(req.url).searchParams.get("format") ?? "json").toLowerCase();

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

/** Find-or-create a global manufacturer by name and ensure the user has a pin. */
async function resolveManufacturer(
  q: ReturnType<typeof sql>,
  name: string,
  userId: number,
  username: string,
): Promise<number> {
  const found = (await q`
    select id from pricing_manufacturers where name = ${name} and deleted_at is null limit 1
  `) as Array<{ id: number }>;
  let mfgId: number;
  if (found.length > 0) {
    mfgId = found[0].id;
  } else {
    const ins = (await q`
      insert into pricing_manufacturers (name, created_by_user_id)
      values (${name}, ${userId})
      returning id
    `) as Array<{ id: number }>;
    mfgId = ins[0].id;
  }
  // Ensure a live pin for this user.
  const pin = (await q`
    select id, deleted_at from pricing_user_manufacturers
    where user_id = ${userId} and manufacturer_id = ${mfgId} limit 1
  `) as Array<{ id: number; deleted_at: string | null }>;
  if (pin.length === 0) {
    await q`
      insert into pricing_user_manufacturers (user_id, manufacturer_id, color, tag)
      values (${userId}, ${mfgId}, ${DEFAULT_USER_COLOR}, ${username})
    `;
  } else if (pin[0].deleted_at) {
    await q`update pricing_user_manufacturers set deleted_at = null where id = ${pin[0].id}`;
  }
  return mfgId;
}

export async function POST(req: Request) {
  try {
    const user = await requireWriter();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const q = sql();

    const { searchParams } = new URL(req.url);
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

    const stamp = new Date().toISOString().slice(0, 10);
    const suffix = ` (restored ${stamp})`;
    let restored = 0;
    let skipped = 0;
    const failures: { name: string; error: string }[] = [];

    for (const m of manufacturers) {
      const name = (m.name ?? "").trim() || "Restored manufacturer";
      const mfgId = await resolveManufacturer(q, name, user.id, user.username);
      // Restore the manufacturer's per-vendor defaults too.
      if (m.defaultShippingRate || m.defaultCustomsRate || m.defaultProfitMargin) {
        try {
          if (m.defaultShippingRate)
            await q`update pricing_manufacturers set default_shipping_rate = ${m.defaultShippingRate} where id = ${mfgId}`;
          if (m.defaultCustomsRate)
            await q`update pricing_manufacturers set default_customs_rate = ${m.defaultCustomsRate} where id = ${mfgId}`;
          if (m.defaultProfitMargin)
            await q`update pricing_manufacturers set default_profit_margin = ${m.defaultProfitMargin} where id = ${mfgId}`;
        } catch {
          // defaults are best-effort
        }
      }
      const r = await restoreProjects(q, mfgId, user.id, m.projects ?? [], suffix);
      restored += r.restored;
      skipped += r.skipped;
      failures.push(...r.failures);
    }

    return NextResponse.json({
      success: failures.length === 0,
      manufacturers: manufacturers.length,
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
