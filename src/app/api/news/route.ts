import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema, usingD1 } from "@/lib/db";
import { requireUser, requireAdmin, canReadAll } from "@/lib/auth";
import { toAudienceArray, audienceOverlaps } from "@/lib/news-audience";

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

/** Same shape as NewsRow but with the audience columns still in their raw DB
 *  form (array on Postgres, JSON text on D1) before normalisation. */
type RawNewsRow = Omit<NewsRow, "audience_modules" | "audience_roles"> & {
  audience_modules: unknown;
  audience_roles: unknown;
};

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
    const isAdmin = canReadAll(user);

    // audience_modules / audience_roles are Postgres text[] but Cloudflare D1
    // stores them as JSON text, and D1 has no `&&` array-overlap operator (it
    // 500'd there). So we fetch the candidate rows WITHOUT an audience SQL
    // filter, normalise the audience columns to arrays, and do the overlap in
    // JS — identical behaviour on both backends.
    const raw = (
      isAdmin && includeArchived
        ? await q`
            select n.id, n.title, n.body, n.audience_modules, n.audience_roles,
                   n.pinned, n.created_by, u.username as created_by_username,
                   n.created_at, n.expires_at, n.deleted_at
            from news_posts n
            left join users u on u.id = n.created_by
            order by n.pinned desc, n.created_at desc
            limit 200
          `
        : await q`
            select n.id, n.title, n.body, n.audience_modules, n.audience_roles,
                   n.pinned, n.created_by, u.username as created_by_username,
                   n.created_at, n.expires_at, n.deleted_at
            from news_posts n
            left join users u on u.id = n.created_by
            where n.deleted_at is null
              and (n.expires_at is null or n.expires_at > now())
            order by n.pinned desc, n.created_at desc
            limit 200
          `
    ) as RawNewsRow[];

    let posts: NewsRow[] = raw.map((r) => ({
      ...r,
      audience_modules: toAudienceArray(r.audience_modules),
      audience_roles: toAudienceArray(r.audience_roles),
    }));
    if (!isAdmin) {
      posts = posts.filter(
        (p) =>
          audienceOverlaps(p.audience_modules, modulesTags) &&
          audienceOverlaps(p.audience_roles, roleTags),
      );
    }
    posts = posts.slice(0, isAdmin && includeArchived ? 200 : 50);

    return NextResponse.json({ posts });
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

    // D1 stores the audience columns as JSON text; Postgres as text[]. Bind the
    // shape each backend expects (the `::text[]` cast is a no-op on D1, which
    // the translator strips).
    const d1 = usingD1();
    const modParam = d1 ? JSON.stringify(audienceModules) : audienceModules;
    const roleParam = d1 ? JSON.stringify(audienceRoles) : audienceRoles;

    const q = sql();
    const inserted = (await q`
      insert into news_posts
        (title, body, audience_modules, audience_roles, pinned, created_by, expires_at)
      values
        (${title}, ${text}, ${modParam}::text[], ${roleParam}::text[],
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
      const param = usingD1() ? JSON.stringify(arr) : arr;
      await q`update news_posts set audience_modules = ${param}::text[] where id = ${id}`;
    }
    if (body.audience_roles !== undefined) {
      const arr = Array.isArray(body.audience_roles)
        ? body.audience_roles.map(String)
        : ["all"];
      const param = usingD1() ? JSON.stringify(arr) : arr;
      await q`update news_posts set audience_roles = ${param}::text[] where id = ${id}`;
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
