import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin-curated dashboard announcements.
 *
 *   GET    — every authenticated user. Returns active (non-deleted,
 *            non-expired) posts. Audience filtering by module / role
 *            is done in SQL using the array overlap operator so a
 *            user only sees posts targeting their roles + the 'all'
 *            audience.
 *   POST   — admin only. Creates a new post.
 *   PATCH  — admin only. Edit body, audience, pinned, expires_at, or
 *            soft-delete by setting `archived: true` (stamps
 *            deleted_at = now()). Unarchive by setting archived:false.
 *            No DELETE handler — every post is preserved.
 */

interface NewsRow {
  id: number;
  title: string;
  body: string;
  audience_modules: string[];
  audience_roles: string[];
  pinned: boolean;
  created_by: number | null;
  created_by_username: string | null;
  created_at: string;
  expires_at: string | null;
  deleted_at: string | null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const includeArchived = searchParams.get("include_archived") === "1";

    const q = sql();
    // Pull the caller's active module roles in the same round-trip so
    // the audience filter is one SQL statement. The 'all' tag in
    // either audience array acts as a wildcard match.
    const roles = (await q`
      select module, role from user_module_roles
      where user_id = ${user.id} and revoked_at is null
    `) as Array<{ module: string; role: string }>;

    const modulesTags = ["all", ...roles.map((r) => r.module)];
    const roleTags = ["all", ...roles.map((r) => r.role)];

    // Admins (legacy or via module grant) see every post regardless of
    // audience — that's the admin-as-curator experience. Everyone else
    // gets audience-filtered + expiry-filtered.
    const isAdmin = user.role === "admin";
    let rows: NewsRow[];
    if (isAdmin && includeArchived) {
      rows = (await q`
        select n.id, n.title, n.body, n.audience_modules, n.audience_roles,
               n.pinned, n.created_by, u.username as created_by_username,
               n.created_at, n.expires_at, n.deleted_at
        from news_posts n
        left join users u on u.id = n.created_by
        order by n.pinned desc, n.created_at desc
        limit 200
      `) as NewsRow[];
    } else if (isAdmin) {
      rows = (await q`
        select n.id, n.title, n.body, n.audience_modules, n.audience_roles,
               n.pinned, n.created_by, u.username as created_by_username,
               n.created_at, n.expires_at, n.deleted_at
        from news_posts n
        left join users u on u.id = n.created_by
        where n.deleted_at is null
          and (n.expires_at is null or n.expires_at > now())
        order by n.pinned desc, n.created_at desc
        limit 50
      `) as NewsRow[];
    } else {
      rows = (await q`
        select n.id, n.title, n.body, n.audience_modules, n.audience_roles,
               n.pinned, n.created_by, u.username as created_by_username,
               n.created_at, n.expires_at, n.deleted_at
        from news_posts n
        left join users u on u.id = n.created_by
        where n.deleted_at is null
          and (n.expires_at is null or n.expires_at > now())
          and n.audience_modules && ${modulesTags}::text[]
          and n.audience_roles && ${roleTags}::text[]
        order by n.pinned desc, n.created_at desc
        limit 50
      `) as NewsRow[];
    }

    return NextResponse.json({ posts: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    await ensureSchema();
    const body = (await req.json()) as {
      title?: string;
      body?: string;
      audience_modules?: string[];
      audience_roles?: string[];
      pinned?: boolean;
      expires_at?: string | null;
    };
    const title = String(body.title ?? "").trim();
    const text = String(body.body ?? "").trim();
    if (!title) {
      return NextResponse.json({ error: "title required" }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json({ error: "body required" }, { status: 400 });
    }
    const audienceModules =
      Array.isArray(body.audience_modules) && body.audience_modules.length > 0
        ? body.audience_modules.map(String)
        : ["all"];
    const audienceRoles =
      Array.isArray(body.audience_roles) && body.audience_roles.length > 0
        ? body.audience_roles.map(String)
        : ["all"];
    const pinned = Boolean(body.pinned);
    const expiresAt =
      body.expires_at && typeof body.expires_at === "string"
        ? body.expires_at
        : null;

    const q = sql();
    const inserted = (await q`
      insert into news_posts
        (title, body, audience_modules, audience_roles, pinned, created_by, expires_at)
      values
        (${title}, ${text}, ${audienceModules}::text[], ${audienceRoles}::text[],
         ${pinned}, ${admin.id}, ${expiresAt})
      returning id
    `) as Array<{ id: number }>;

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${admin.id}, 'news_post', ${inserted[0].id}, 'create',
              ${JSON.stringify({ title, pinned })}::jsonb)
    `;

    return NextResponse.json({ ok: true, id: inserted[0].id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    await ensureSchema();
    const body = (await req.json()) as {
      id?: number;
      title?: string;
      body?: string;
      audience_modules?: string[];
      audience_roles?: string[];
      pinned?: boolean;
      expires_at?: string | null;
      archived?: boolean;
    };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const q = sql();
    const existing = (await q`
      select id from news_posts where id = ${id}
    `) as Array<{ id: number }>;
    if (existing.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    if (body.title !== undefined) {
      const t = String(body.title).trim();
      if (!t) {
        return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
      }
      await q`update news_posts set title = ${t} where id = ${id}`;
    }
    if (body.body !== undefined) {
      const t = String(body.body).trim();
      if (!t) {
        return NextResponse.json({ error: "body cannot be empty" }, { status: 400 });
      }
      await q`update news_posts set body = ${t} where id = ${id}`;
    }
    if (body.audience_modules !== undefined) {
      const arr = Array.isArray(body.audience_modules)
        ? body.audience_modules.map(String)
        : ["all"];
      await q`update news_posts set audience_modules = ${arr}::text[] where id = ${id}`;
    }
    if (body.audience_roles !== undefined) {
      const arr = Array.isArray(body.audience_roles)
        ? body.audience_roles.map(String)
        : ["all"];
      await q`update news_posts set audience_roles = ${arr}::text[] where id = ${id}`;
    }
    if (body.pinned !== undefined) {
      await q`update news_posts set pinned = ${Boolean(body.pinned)} where id = ${id}`;
    }
    if (body.expires_at !== undefined) {
      const v =
        body.expires_at && typeof body.expires_at === "string"
          ? body.expires_at
          : null;
      await q`update news_posts set expires_at = ${v} where id = ${id}`;
    }
    if (body.archived !== undefined) {
      await q`
        update news_posts
        set deleted_at = ${body.archived ? new Date().toISOString() : null}
        where id = ${id}
      `;
    }

    await q`
      insert into activity_log (actor_id, entity_type, entity_id, verb, meta_json)
      values (${admin.id}, 'news_post', ${id}, 'update', ${JSON.stringify(body)}::jsonb)
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
