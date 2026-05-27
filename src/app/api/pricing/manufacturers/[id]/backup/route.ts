export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, requireWriter } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { isPricingAdmin } from "@/lib/pricing/access";

const BACKUP_FORMAT_VERSION = 1;

interface BackupLine {
  position: number;
  itemModel: string;
  priceUsd: string;
  quantity: number;
  shippingOverride: string | null;
  customsOverride: string | null;
  shippingRateOverride: string | null;
  customsRateOverride: string | null;
  profitRateOverride: string | null;
}

interface BackupConstants {
  currencyRate: string;
  shippingRate: string;
  customsRate: string;
  profitMargin: string;
  taxRate: string;
  targetCurrency: string;
  sourceCurrency: string;
}

interface BackupProject {
  name: string;
  date: string | null;
  responsiblePerson: string | null;
  createdAt: string;
  constants: BackupConstants | null;
  productLines: BackupLine[];
}

interface BackupPayload {
  formatVersion: number;
  exportedAt: string;
  manufacturer: { id: number; name: string };
  projects: BackupProject[];
}

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

function jsonDownload(payload: BackupPayload, mfgName: string) {
  const safe = mfgName.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "backup";
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${safe}-projects-${stamp}.json"`,
    },
  });
}

export async function GET(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const { id } = await params;
    const mfgId = parseInt(id, 10);
    if (Number.isNaN(mfgId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const access = await ensureManufacturerAccess(mfgId, user);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { searchParams } = new URL(req.url);
    const ownerParam = searchParams.get("ownerUserId");
    const ownerUserId =
      ownerParam != null && Number.isFinite(parseInt(ownerParam, 10))
        ? parseInt(ownerParam, 10)
        : null;

    const q = sql();
    const admin = isPricingAdmin(user);
    const projectRows = (admin
      ? ownerUserId != null
        ? ((await q`
            select id, name, date, responsible_person, created_at, user_id
            from pricing_projects
            where manufacturer_id = ${mfgId}
              and deleted_at is null
              and user_id = ${ownerUserId}
            order by created_at asc
          `) as Array<Record<string, unknown>>)
        : ((await q`
            select id, name, date, responsible_person, created_at, user_id
            from pricing_projects
            where manufacturer_id = ${mfgId} and deleted_at is null
            order by created_at asc
          `) as Array<Record<string, unknown>>)
      : ((await q`
          select id, name, date, responsible_person, created_at, user_id
          from pricing_projects
          where manufacturer_id = ${mfgId}
            and deleted_at is null
            and user_id = ${user.id}
          order by created_at asc
        `) as Array<Record<string, unknown>>));

    if (projectRows.length === 0) {
      return jsonDownload(
        {
          formatVersion: BACKUP_FORMAT_VERSION,
          exportedAt: new Date().toISOString(),
          manufacturer: access.manufacturer,
          projects: [],
        },
        access.manufacturer.name,
      );
    }

    const projectIds = projectRows.map((p) => p.id as number);
    const constants = (await q`
      select project_id, currency_rate, shipping_rate, customs_rate,
             profit_margin, tax_rate, target_currency, source_currency
      from pricing_project_constants
      where project_id = any(${projectIds}::int[])
    `) as Array<Record<string, unknown>>;
    const constMap = new Map<number, BackupConstants>();
    for (const c of constants) {
      constMap.set(c.project_id as number, {
        currencyRate: String(c.currency_rate),
        shippingRate: String(c.shipping_rate),
        customsRate: String(c.customs_rate),
        profitMargin: String(c.profit_margin),
        taxRate: String(c.tax_rate),
        targetCurrency: String(c.target_currency),
        sourceCurrency: String(c.source_currency),
      });
    }
    const lines = (await q`
      select project_id, position, item_model, price_usd, quantity,
             shipping_override, customs_override,
             shipping_rate_override, customs_rate_override, profit_rate_override
      from pricing_product_lines
      where project_id = any(${projectIds}::int[])
      order by project_id asc, position asc
    `) as Array<Record<string, unknown>>;
    const lineMap = new Map<number, BackupLine[]>();
    for (const l of lines) {
      const pid = l.project_id as number;
      const bucket = lineMap.get(pid) ?? [];
      bucket.push({
        position: l.position as number,
        itemModel: (l.item_model as string) ?? "",
        priceUsd: String(l.price_usd),
        quantity: l.quantity as number,
        shippingOverride: l.shipping_override != null ? String(l.shipping_override) : null,
        customsOverride: l.customs_override != null ? String(l.customs_override) : null,
        shippingRateOverride:
          l.shipping_rate_override != null ? String(l.shipping_rate_override) : null,
        customsRateOverride:
          l.customs_rate_override != null ? String(l.customs_rate_override) : null,
        profitRateOverride:
          l.profit_rate_override != null ? String(l.profit_rate_override) : null,
      });
      lineMap.set(pid, bucket);
    }

    const payload: BackupPayload = {
      formatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      manufacturer: access.manufacturer,
      projects: projectRows.map((p) => ({
        name: p.name as string,
        date: (p.date as string | null) ?? null,
        responsiblePerson: (p.responsible_person as string | null) ?? null,
        createdAt:
          p.created_at instanceof Date
            ? (p.created_at as Date).toISOString()
            : String(p.created_at ?? ""),
        constants: constMap.get(p.id as number) ?? null,
        productLines: lineMap.get(p.id as number) ?? [],
      })),
    };
    return jsonDownload(payload, access.manufacturer.name);
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
    if (Number.isNaN(mfgId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const access = await ensureManufacturerAccess(mfgId, user);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { searchParams } = new URL(req.url);
    const ownerParam = searchParams.get("ownerUserId");
    const requestedOwnerId =
      ownerParam != null && Number.isFinite(parseInt(ownerParam, 10))
        ? parseInt(ownerParam, 10)
        : null;
    const restoreOwnerId =
      isPricingAdmin(user) && requestedOwnerId != null
        ? requestedOwnerId
        : user.id;

    const body = (await req.json().catch(() => null)) as
      | Partial<BackupPayload>
      | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    if (!Array.isArray(body.projects)) {
      return NextResponse.json(
        { error: "Payload missing 'projects' array" },
        { status: 400 },
      );
    }

    const q = sql();
    const stamp = new Date().toISOString().slice(0, 10);
    const created: { id: number; name: string }[] = [];
    const failures: { name: string; error: string }[] = [];
    let skipped = 0;

    for (const bp of body.projects) {
      if (!bp || typeof bp !== "object" || typeof bp.name !== "string" || !bp.name.trim()) {
        skipped++;
        continue;
      }
      const name = `${bp.name.trim()} (restored ${stamp})`;

      // Import each project atomically: the project row, its constants and
      // ALL its product lines are written in one transaction. Previously
      // these were three independent statements with no transaction, so a
      // failure on the line insert left a project with a title but no line
      // data, and aborted every project after it ("titles only, data
      // dropped"). Now a project either lands complete or not at all, and a
      // single bad project is recorded in `failures` instead of killing the
      // whole import.
      try {
        const project = await q.begin(async (tx) => {
          const projectRows = (await tx`
            insert into pricing_projects (
              name, date, responsible_person, manufacturer_id, user_id
            ) values (
              ${name},
              ${bp.date ?? null},
              ${typeof bp.responsiblePerson === "string" ? bp.responsiblePerson : null},
              ${mfgId},
              ${restoreOwnerId}
            )
            returning id, name
          `) as Array<{ id: number; name: string }>;
          const proj = projectRows[0];

          const c = bp.constants ?? null;
          await tx`
            insert into pricing_project_constants (
              project_id, currency_rate, shipping_rate, customs_rate,
              profit_margin, tax_rate, target_currency, source_currency
            ) values (
              ${proj.id},
              ${c?.currencyRate ?? "0.710000"},
              ${c?.shippingRate ?? "0.150000"},
              ${c?.customsRate  ?? "0.120000"},
              ${c?.profitMargin ?? "0.250000"},
              ${c?.taxRate      ?? "0.160000"},
              ${c?.targetCurrency ?? "JOD"},
              ${c?.sourceCurrency ?? "USD"}
            )
          `;

          const lines = Array.isArray(bp.productLines) ? bp.productLines : [];
          if (lines.length > 0) {
            // De-dupe positions so a malformed backup (repeated positions)
            // can't trip the (project_id, position) unique constraint and
            // wipe out the whole project's line import.
            const seen = new Set<number>();
            const rows = lines.map((l, idx) => {
              let position = typeof l.position === "number" ? l.position : idx + 1;
              while (seen.has(position)) position++;
              seen.add(position);
              return {
                project_id: proj.id,
                position,
                item_model: typeof l.itemModel === "string" ? l.itemModel : "",
                price_usd: l.priceUsd != null ? String(l.priceUsd) : "0",
                quantity:
                  typeof l.quantity === "number" && l.quantity > 0 ? l.quantity : 1,
                shipping_override:
                  l.shippingOverride != null ? String(l.shippingOverride) : null,
                customs_override:
                  l.customsOverride != null ? String(l.customsOverride) : null,
                shipping_rate_override:
                  l.shippingRateOverride != null ? String(l.shippingRateOverride) : null,
                customs_rate_override:
                  l.customsRateOverride != null ? String(l.customsRateOverride) : null,
                profit_rate_override:
                  l.profitRateOverride != null ? String(l.profitRateOverride) : null,
              };
            });
            await tx`insert into pricing_product_lines ${tx(rows)}`;
          }
          return proj;
        });
        created.push({ id: project.id, name: project.name });
      } catch (projErr) {
        failures.push({
          name: bp.name.trim(),
          error: (projErr as Error).message || "insert failed",
        });
      }
    }

    return NextResponse.json({
      success: failures.length === 0,
      restored: created.length,
      skipped,
      failed: failures.length,
      failures,
      projects: created,
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
