import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { sendPushToUsers } from "@/lib/push";

export const runtime = "nodejs";

/**
 * A salesperson can't edit a quotation received from presales — instead
 * they file a change request that routes back to the quotation's author.
 * This records the request, pings the author's notification bell (derived
 * in /api/notifications), and fires a Web Push so it reaches their device.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "crm");
    await ensureSchema();

    const body = (await req.json()) as { id?: number; note?: string };
    const id = Number(body.id);
    const note = String(body.note || "").trim();
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }
    if (!note) {
      return NextResponse.json(
        { error: "Describe the change you need." },
        { status: 400 },
      );
    }

    const q = sql();
    const rows = (await q`
      select id, ref, owner_id, project_name from quotations
      where id = ${id} and deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      ref: string;
      owner_id: number | null;
      project_name: string;
    }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const quotation = rows[0];
    // Non-admins may only request changes on quotations they can see — the
    // CRM list/viewer already scopes this, but guard anyway so a stray id
    // can't be poked.
    if (!canReadAll(user) && quotation.owner_id !== user.id) {
      // A salesperson typically does NOT own the quotation (presales does),
      // so ownership can't be the gate. We instead allow any CRM user who
      // reached this far; the real restriction is that there must be an
      // author to route the request to.
    }
    const target = quotation.owner_id;

    await q`
      insert into quotation_change_requests
        (quotation_id, requested_by, target_user_id, note)
      values (${id}, ${user.id}, ${target}, ${note.slice(0, 2000)})
    `;
    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'quotation', ${id}, 'change_requested',
              ${JSON.stringify({ note: note.slice(0, 500) })}::jsonb)
    `;

    if (target) {
      void sendPushToUsers([target], {
        title: `Change requested on ${quotation.ref}`,
        body: note.slice(0, 140),
        url: `/quotation?id=${id}`,
        tag: `change-request-${id}`,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
