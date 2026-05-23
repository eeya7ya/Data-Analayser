export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { isPricingAdmin } from "@/lib/pricing/access";

/**
 * Bulk export used by the compare view. Returns every manufacturer
 * the caller can see, each populated with its projects, project
 * constants and product lines so the client can render side-by-side
 * comparisons without further round-trips.
 *
 * Non-admins only get their own projects nested inside each shared
 * manufacturer; admins get every project.
 */
export async function GET() {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();

    const q = sql();
    const admin = isPricingAdmin(user);

    const manufacturers = (await q`
      select id, name, color, tag, created_by_user_id, created_at
      from pricing_manufacturers
      where deleted_at is null
      order by created_at asc
    `) as Array<Record<string, unknown>>;
    if (manufacturers.length === 0) return NextResponse.json([]);
    const mfgIds = manufacturers.map((m) => m.id as number);

    const projects = (admin
      ? ((await q`
          select id, name, date, responsible_person, manufacturer_id,
                 user_id, parent_project_id, revision_number, created_at
          from pricing_projects
          where deleted_at is null
            and manufacturer_id = any(${mfgIds}::int[])
          order by created_at asc
        `) as Array<Record<string, unknown>>)
      : ((await q`
          select id, name, date, responsible_person, manufacturer_id,
                 user_id, parent_project_id, revision_number, created_at
          from pricing_projects
          where deleted_at is null
            and user_id = ${user.id}
            and manufacturer_id = any(${mfgIds}::int[])
          order by created_at asc
        `) as Array<Record<string, unknown>>));
    if (projects.length === 0) {
      return NextResponse.json(
        manufacturers.map((m) => ({ manufacturer: m, projects: [] })),
      );
    }
    const projectIds = projects.map((p) => p.id as number);

    const constants = (await q`
      select project_id, currency_rate, shipping_rate, customs_rate,
             profit_margin, tax_rate, target_currency, source_currency
      from pricing_project_constants
      where project_id = any(${projectIds}::int[])
    `) as Array<Record<string, unknown>>;
    const lines = (await q`
      select project_id, id, position, item_model, price_usd, quantity,
             shipping_override, customs_override,
             shipping_rate_override, customs_rate_override, profit_rate_override
      from pricing_product_lines
      where project_id = any(${projectIds}::int[])
      order by project_id asc, position asc
    `) as Array<Record<string, unknown>>;

    const constantsByProject = new Map<number, unknown>();
    for (const c of constants) constantsByProject.set(c.project_id as number, c);
    const linesByProject = new Map<number, Array<Record<string, unknown>>>();
    for (const l of lines) {
      const arr = linesByProject.get(l.project_id as number) ?? [];
      arr.push(l);
      linesByProject.set(l.project_id as number, arr);
    }
    const projectsByMfg = new Map<
      number,
      Array<{ project: Record<string, unknown>; constants: unknown; productLines: Array<Record<string, unknown>> }>
    >();
    for (const p of projects) {
      const mfgId = p.manufacturer_id as number;
      const arr = projectsByMfg.get(mfgId) ?? [];
      arr.push({
        project: p,
        constants: constantsByProject.get(p.id as number) ?? null,
        productLines: linesByProject.get(p.id as number) ?? [],
      });
      projectsByMfg.set(mfgId, arr);
    }

    return NextResponse.json(
      manufacturers.map((m) => ({
        manufacturer: m,
        projects: projectsByMfg.get(m.id as number) ?? [],
      })),
    );
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
