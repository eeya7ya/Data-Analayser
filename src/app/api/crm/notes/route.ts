import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";
import { logActivity } from "@/lib/crm/activity";

export const runtime = "nodejs";

interface NoteRow {
  id: number;
  owner_id: number | null;
  author_id: number | null;
  entity_type: string;
  entity_id: number;
  body: string;
  created_at: string;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const url = new URL(req.url);
    const entityType = url.searchParams.get("entity_type");
    const entityIdRaw = url.searchParams.get("entity_id");
    if (!entityType || !entityIdRaw) throw new Error("BAD_REQUEST");
    const entityId = Number(entityIdRaw);
    const q = sql();
    const rows = (user.role === "admin"
      ? await q`
          select n.id, n.owner_id, n.author_id, n.entity_type, n.entity_id,
                 n.body, n.created_at, u.username as author_username
          from notes n
          left join users u on u.id = n.author_id
          where n.entity_type = ${entityType} and n.entity_id = ${entityId}
            and n.deleted_at is null
          order by n.created_at desc
          limit 200
        `
      : await q`
          select n.id, n.owner_id, n.author_id, n.entity_type, n.entity_id,
                 n.body, n.created_at, u.username as author_username
          from notes n
          left join users u on u.id = n.author_id
          where n.entity_type = ${entityType} and n.entity_id = ${entityId}
            and n.owner_id = ${user.id}
            and n.deleted_at is null
          order by n.created_at desc
          limit 200
        `) as Array<NoteRow & { author_username: string | null }>;
    return NextResponse.json({ notes: rows });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const body = (await req.json()) as Partial<NoteRow>;
    const text = (body.body ?? "").trim();
    if (!text || !body.entity_type || !body.entity_id) throw new Error("BAD_REQUEST");
    const q = sql();
    const created = (await q`
      insert into notes (owner_id, author_id, entity_type, entity_id, body)
      values (${user.id}, ${user.id}, ${body.entity_type}, ${body.entity_id}, ${text})
      returning id, owner_id, author_id, entity_type, entity_id, body, created_at
    `) as NoteRow[];
    await logActivity({
      ownerId: created[0].owner_id,
      actorId: user.id,
      entityType: created[0].entity_type as never,
      entityId: created[0].entity_id,
      verb: "noted",
      meta: { note_id: created[0].id },
    });

    // @mention notifications: extract @username from body, look up matching
    // users, and push an in-app notification per match.
    const handles = Array.from(text.matchAll(/@([a-zA-Z0-9_.-]+)/g)).map((m) => m[1]);
    if (handles.length > 0) {
      const mentioned = (await q`
        select id, username from users where username = any(${handles}::text[])
      `) as Array<{ id: number; username: string }>;
      for (const m of mentioned) {
        if (m.id === user.id) continue;
        await q`
          insert into notifications (user_id, kind, title, body, link)
          values (
            ${m.id},
            ${"mention"},
            ${"Mentioned by " + user.username},
            ${text.slice(0, 240)},
            ${`/crm/${body.entity_type}s/${body.entity_id}`}
          )
        `;
      }
    }

    return NextResponse.json({ note: created[0] }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
