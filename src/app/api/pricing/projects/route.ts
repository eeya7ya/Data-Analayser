export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, requireWriter } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { isPricingAdmin } from "@/lib/pricing/access";

/**
 * List pricing projects scoped to a manufacturer. Admins see every
 * project in the manufacturer (optionally narrowed to one owner via
 * `?ownerUserId=` when the admin is acting inside a specific user's
 * card); regular users see their own.
 *
 * Rows are ordered so each root project is followed by its revisions
 * v1 → v2 → v3, so the dropdown reads as a stable history rather than
 * jumping around by creation order.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const manufacturerId = searchParams.get("manufacturerId");
    if (!manufacturerId) {
      return NextResponse.json(
        { error: "manufacturerId required" },
        { status: 400 },
      );
    }
    const mfgId = parseInt(manufacturerId, 10);
    const ownerParam = searchParams.get("ownerUserId");
    const ownerUserId = ownerParam != null ? parseInt(ownerParam, 10) : NaN;
    const hasOwnerFilter = Number.isFinite(ownerUserId);

    const q = sql();
    const projects = (isPricingAdmin(user)
      ? hasOwnerFilter
        ? ((await q`
            select id, name, date, responsible_person, manufacturer_id,
                   user_id, parent_project_id, revision_number,
                   created_at, deleted_at
            from pricing_projects
            where manufacturer_id = ${mfgId}
              and deleted_at is null
              and user_id = ${ownerUserId}
            order by coalesce(parent_project_id, id) asc,
                     revision_number asc,
                     created_at asc
          `) as Array<Record<string, unknown>>)
        : ((await q`
            select id, name, date, responsible_person, manufacturer_id,
                   user_id, parent_project_id, revision_number,
                   created_at, deleted_at
            from pricing_projects
            where manufacturer_id = ${mfgId}
              and deleted_at is null
            order by coalesce(parent_project_id, id) asc,
                     revision_number asc,
                     created_at asc
          `) as Array<Record<string, unknown>>)
      : ((await q`
          select id, name, date, responsible_person, manufacturer_id,
                 user_id, parent_project_id, revision_number,
                 created_at, deleted_at
          from pricing_projects
          where manufacturer_id = ${mfgId}
            and deleted_at is null
            and user_id = ${user.id}
          order by coalesce(parent_project_id, id) asc,
                   revision_number asc,
                   created_at asc
        `) as Array<Record<string, unknown>>));
    return NextResponse.json(projects);
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/**
 * Create a new pricing project inside a manufacturer. Seeds the default
 * constants row and five blank product lines so the editor lands on a
 * ready-to-fill sheet (mirrors the pricing-sheet app's UX). Admins can
 * stamp the project onto another user by passing `ownerUserId`.
 */
export async function POST(req: Request) {
  try {
    const user = await requireWriter();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      manufacturerId?: number | string;
      responsiblePerson?: string;
      ownerUserId?: number | string;
    };
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (body.manufacturerId == null) {
      return NextResponse.json(
        { error: "manufacturerId is required" },
        { status: 400 },
      );
    }
    const mfgId =
      typeof body.manufacturerId === "number"
        ? body.manufacturerId
        : parseInt(body.manufacturerId, 10);

    const requestedOwner =
      typeof body.ownerUserId === "number"
        ? body.ownerUserId
        : typeof body.ownerUserId === "string"
          ? parseInt(body.ownerUserId, 10)
          : NaN;
    const ownerId =
      isPricingAdmin(user) && Number.isFinite(requestedOwner)
        ? requestedOwner
        : user.id;

    const q = sql();
    const projectRows = (await q`
      insert into pricing_projects (
        name, responsible_person, manufacturer_id, user_id
      ) values (
        ${body.name.trim()},
        ${body.responsiblePerson?.trim() || null},
        ${mfgId},
        ${ownerId}
      )
      returning id, name, date, responsible_person, manufacturer_id,
                user_id, parent_project_id, revision_number,
                created_at, deleted_at
    `) as Array<Record<string, unknown>>;
    const project = projectRows[0];
    const projectId = project.id as number;

    // Seed the constants row with the column (global) defaults, then override
    // shipping / customs / profit with this manufacturer's per-vendor defaults
    // where the admin set them (NULL leaves the global default in place).
    await q`
      insert into pricing_project_constants (project_id) values (${projectId})
    `;
    const mfgDefaults = (await q`
      select default_shipping_rate as ship, default_customs_rate as cust,
             default_profit_margin as profit
      from pricing_manufacturers where id = ${mfgId} limit 1
    `) as Array<{
      ship: number | string | null;
      cust: number | string | null;
      profit: number | string | null;
    }>;
    const md = mfgDefaults[0];
    if (md) {
      // Build the SET clause from only the defaults the manufacturer actually
      // carries — no cast / coalesce, so it runs identically on Postgres and
      // D1/SQLite (NULL leaves the seeded global default in place).
      const constPatch: Record<string, unknown> = {};
      if (md.ship !== null) constPatch.shipping_rate = md.ship;
      if (md.cust !== null) constPatch.customs_rate = md.cust;
      if (md.profit !== null) constPatch.profit_margin = md.profit;
      const keys = Object.keys(constPatch) as Array<keyof typeof constPatch>;
      if (keys.length > 0) {
        await q`
          update pricing_project_constants
          set ${q(constPatch, ...keys)}
          where project_id = ${projectId}
        `;
      }
    }

    // Seed five empty product lines so the editor opens on a usable grid.
    // Explicit VALUES (not generate_series, which D1/SQLite lacks).
    await q`
      insert into pricing_product_lines (project_id, position, item_model, price_usd, quantity)
      values
        (${projectId}, 1, '', 0, 1),
        (${projectId}, 2, '', 0, 1),
        (${projectId}, 3, '', 0, 1),
        (${projectId}, 4, '', 0, 1),
        (${projectId}, 5, '', 0, 1)
    `;

    return NextResponse.json(project, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
