import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const url = new URL(req.url);
    const entityType = url.searchParams.get("entity_type");
    const entityIdRaw = url.searchParams.get("entity_id");

    const q = sql();
    let rows;
    if (entityType && entityIdRaw) {
      const entityId = Number(entityIdRaw);
      rows = (user.role === "admin"
        ? await q`
            select a.id, a.verb, a.meta_json, a.created_at,
                   u.username as actor_username
            from activity_log a
            left join users u on u.id = a.actor_id
            where a.entity_type = ${entityType} and a.entity_id = ${entityId}
            order by a.created_at desc
            limit 100
          `
        : await q`
            select a.id, a.verb, a.meta_json, a.created_at,
                   u.username as actor_username
            from activity_log a
            left join users u on u.id = a.actor_id
            where a.entity_type = ${entityType} and a.entity_id = ${entityId}
              and a.owner_id = ${user.id}
            order by a.created_at desc
            limit 100
          `);
    } else {
      rows = (user.role === "admin"
        ? await q`
            select a.id, a.entity_type, a.entity_id, a.verb, a.meta_json, a.created_at,
                   u.username as actor_username
            from activity_log a
            left join users u on u.id = a.actor_id
            order by a.created_at desc
            limit 100
          `
        : await q`
            select a.id, a.entity_type, a.entity_id, a.verb, a.meta_json, a.created_at,
                   u.username as actor_username
            from activity_log a
            left join users u on u.id = a.actor_id
            where a.owner_id = ${user.id}
            order by a.created_at desc
            limit 100
          `);
    }
    return NextResponse.json({ activity: rows });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
