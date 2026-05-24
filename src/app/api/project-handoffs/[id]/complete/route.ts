import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll } from "@/lib/auth";
import { hasModuleRole } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/project-handoffs/:id/complete
 *
 * Marks an assigned handoff complete. Allowed for the assigned member,
 * a projects manager, or an admin. Only valid from `assigned`.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await ensureSchema();

    const { id } = await ctx.params;
    const handoffId = Number(id);
    if (!Number.isInteger(handoffId) || handoffId <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    const q = sql();
    const rows = (await q`
      select id, status, assigned_user_id from project_handoffs
      where id = ${handoffId}
      limit 1
    `) as Array<{ id: number; status: string; assigned_user_id: number | null }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "handoff not found" }, { status: 404 });
    }
    const handoff = rows[0];

    const isAdmin = canReadAll(user);
    const isManager =
      isAdmin || (await hasModuleRole(user.id, "projects", "manager"));
    const isAssignee = handoff.assigned_user_id === user.id;
    if (!isManager && !isAssignee) {
      return NextResponse.json(
        { error: "only the assigned member or a projects manager can complete this" },
        { status: 403 },
      );
    }

    if (handoff.status !== "assigned") {
      return NextResponse.json(
        { error: `cannot complete a handoff with status "${handoff.status}"` },
        { status: 409 },
      );
    }

    await q`
      update project_handoffs
      set status = 'completed', completed_at = now(), updated_at = now()
      where id = ${handoffId}
    `;
    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${user.id}, 'project_handoff', ${handoffId}, 'complete', '{}'::jsonb)
    `;

    return NextResponse.json({ ok: true, status: "completed" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const s = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status: s });
  }
}
