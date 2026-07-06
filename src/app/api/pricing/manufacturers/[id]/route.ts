export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, requireWriter, requireAdmin } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { isPricingAdmin } from "@/lib/pricing/access";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const { id } = await params;
    const mfgId = parseInt(id, 10);

    const q = sql();
    const rows = (await q`
      select id, name, color, tag, created_by_user_id, created_at
      from pricing_manufacturers
      where id = ${mfgId} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      name: string;
      color: string | null;
      tag: string | null;
      created_by_user_id: number | null;
      created_at: string;
    }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const manufacturer = rows[0];

    if (!isPricingAdmin(user)) {
      const pinRows = (await q`
        select color, tag from pricing_user_manufacturers
        where user_id = ${user.id}
          and manufacturer_id = ${mfgId}
          and deleted_at is null
        limit 1
      `) as Array<{ color: string; tag: string }>;
      if (pinRows.length === 0) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json({
        ...manufacturer,
        color: pinRows[0].color,
        tag: pinRows[0].tag,
      });
    }
    return NextResponse.json(manufacturer);
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/**
 * Rename / recolour a manufacturer. Admins update the global row;
 * regular users can change their own pin's colour/tag and may rename
 * the global row only if they were the one who created it.
 */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const user = await requireWriter();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const { id } = await params;
    const mfgId = parseInt(id, 10);
    const q = sql();

    const existingRows = (await q`
      select id, name, color, tag, created_by_user_id
      from pricing_manufacturers
      where id = ${mfgId} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      name: string;
      color: string | null;
      tag: string | null;
      created_by_user_id: number | null;
    }>;
    if (existingRows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const existing = existingRows[0];

    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      color?: string | null;
      tag?: string | null;
    };

    if (!isPricingAdmin(user)) {
      const pinRows = (await q`
        select id, color, tag from pricing_user_manufacturers
        where user_id = ${user.id}
          and manufacturer_id = ${mfgId}
          and deleted_at is null
        limit 1
      `) as Array<{ id: number; color: string; tag: string }>;
      if (pinRows.length === 0) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      let pin = pinRows[0];
      const nextColor =
        typeof body.color === "string" && body.color.trim()
          ? body.color.trim()
          : pin.color;
      const nextTag =
        typeof body.tag === "string" && body.tag.trim()
          ? body.tag.trim()
          : pin.tag;
      if (nextColor !== pin.color || nextTag !== pin.tag) {
        const upd = (await q`
          update pricing_user_manufacturers
          set color = ${nextColor}, tag = ${nextTag}
          where id = ${pin.id}
          returning id, color, tag
        `) as Array<{ id: number; color: string; tag: string }>;
        pin = upd[0];
      }

      let manufacturer = existing;
      if (
        typeof body.name === "string" &&
        body.name.trim() &&
        existing.created_by_user_id === user.id
      ) {
        const upd = (await q`
          update pricing_manufacturers
          set name = ${body.name.trim()}
          where id = ${mfgId} and deleted_at is null
          returning id, name, color, tag, created_by_user_id
        `) as Array<typeof existing>;
        if (upd.length > 0) manufacturer = upd[0];
      }
      return NextResponse.json({
        ...manufacturer,
        color: pin.color,
        tag: pin.tag,
      });
    }

    // Admin path — patch the global row directly.
    const patch: {
      name?: string;
      color?: string | null;
      tag?: string | null;
    } = {};
    if (typeof body.name === "string") {
      if (!body.name.trim()) {
        return NextResponse.json(
          { error: "Name is required" },
          { status: 400 },
        );
      }
      patch.name = body.name.trim();
    }
    if (Object.prototype.hasOwnProperty.call(body, "color")) {
      patch.color =
        typeof body.color === "string" && body.color.trim()
          ? body.color.trim()
          : null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "tag")) {
      patch.tag =
        typeof body.tag === "string" && body.tag.trim()
          ? body.tag.trim()
          : null;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    // Apply each provided field as its own plain template update. The
    // postgres.js `sql(obj, ...keys)` dynamic-SET helper is not supported by
    // the D1 client (it can't compose query fragments), so a shared helper
    // here would fail on D1 with `near "?": syntax error`.
    if (patch.name !== undefined) {
      await q`update pricing_manufacturers set name = ${patch.name} where id = ${mfgId} and deleted_at is null`;
    }
    if (patch.color !== undefined) {
      await q`update pricing_manufacturers set color = ${patch.color} where id = ${mfgId} and deleted_at is null`;
    }
    if (patch.tag !== undefined) {
      await q`update pricing_manufacturers set tag = ${patch.tag} where id = ${mfgId} and deleted_at is null`;
    }
    const rows = (await q`
      select id, name, color, tag, created_by_user_id
      from pricing_manufacturers
      where id = ${mfgId} and deleted_at is null
      limit 1
    `) as Array<typeof existing>;
    const updated = rows[0];
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/**
 * Delete a manufacturer AND its pricing sheets.
 *
 *   • Admin — soft-delete the GLOBAL `pricing_manufacturers` row (removes the
 *     brand for everyone) and every sheet under it.
 *   • Regular user — unpin only THEIR OWN pin (the global row is shared, so we
 *     never touch it or other users' pins) and soft-delete THEIR OWN sheets
 *     under it.
 *
 * The sheets are cascaded on purpose: previously delete only removed the pin,
 * so re-adding the manufacturer restored the pin and every old sheet came back
 * ("I delete it and create it again and it renders the old data"). Cascading
 * the sheets makes a re-add a genuine clean slate. Soft-delete, not a hard
 * wipe, so the sheets land in Trash (/pricing/trash) and can be restored or
 * purged there.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireWriter();
    await requireModuleAllowLegacy(user, "pricing");
    await ensureSchema();
    const { id } = await params;
    const mfgId = parseInt(id, 10);
    const q = sql();

    if (!isPricingAdmin(user)) {
      const pinRows = (await q`
        select id from pricing_user_manufacturers
        where user_id = ${user.id}
          and manufacturer_id = ${mfgId}
          and deleted_at is null
        limit 1
      `) as Array<{ id: number }>;
      if (pinRows.length === 0) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      // Cascade to this user's sheets under the manufacturer so re-adding
      // starts clean.
      await q`
        update pricing_projects
        set deleted_at = now()
        where manufacturer_id = ${mfgId}
          and user_id = ${user.id}
          and deleted_at is null
      `;
      await q`
        update pricing_user_manufacturers
        set deleted_at = now()
        where id = ${pinRows[0].id}
      `;
      return NextResponse.json({ success: true });
    }

    // Admin: remove the shared brand and every sheet under it.
    await q`
      update pricing_projects
      set deleted_at = now()
      where manufacturer_id = ${mfgId}
        and deleted_at is null
    `;
    await q`
      update pricing_manufacturers
      set deleted_at = now()
      where id = ${mfgId} and deleted_at is null
    `;
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
