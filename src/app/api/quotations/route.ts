import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import type { Sql } from "postgres";

export const runtime = "nodejs";

type QuotationMode = "active" | "draft" | "review";

/**
 * Extract the leading initial for the owner of a quotation. We prefer the
 * display name (human-friendly, usually the first name) and fall back to the
 * username, finally 'X' for the exotic case of a user with no readable
 * identifier at all. Uppercased so the REF stays ASCII-stable.
 */
function ownerInitial(displayName: string | null | undefined, username: string): string {
  const src = (displayName && displayName.trim()) || (username && username.trim()) || "X";
  const ch = src.charAt(0);
  // Only A–Z make sense in a REF; anything else (digits, punctuation, a
  // non-Latin letter) collapses back to 'X' so the REF stays greppable.
  return /[A-Za-z]/.test(ch) ? ch.toUpperCase() : "X";
}

/**
 * "Smart" REF for a brand-new active quotation.
 *
 * Format: Q<L><DDMMYY>MT<n>
 *   L  — first letter of the assigned user's display name
 *   DD — zero-padded day of month
 *   MM — zero-padded month
 *   YY — last two digits of the year
 *   n  — per-user counter of active quotations, incremented on each new /
 *        copied / duplicated record
 *
 * Drafts and reviews never bump `n`; they live under the parent's REF with
 * D<m> / R<m> suffixes instead (see {@link genSuffixedRef}).
 *
 * The counter is seeded from `count(*)` over the user's existing active
 * quotations (including soft-deleted ones, so trashed records don't free
 * numbers for reuse) and then probed against the unique constraint on
 * `ref`. Two users who share an initial and save on the same day would
 * otherwise collide — the retry loop just bumps `n` until the DB accepts
 * the insert.
 */
async function genActiveRef(
  q: Sql,
  userInitial: string,
  ownerId: number,
): Promise<string> {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);

  const countRows = (await q`
    select count(*)::int as c from quotations
    where owner_id = ${ownerId} and status = 'active'
  `) as Array<{ c: number }>;
  let n = (countRows[0]?.c ?? 0) + 1;

  // Collision guard. The unique index on `ref` is the source of truth; this
  // pre-check just saves a failed INSERT round-trip on a contended day.
  for (let attempts = 0; attempts < 50; attempts++) {
    const candidate = `Q${userInitial}${dd}${mm}${yy}MT${n}`;
    const existing = (await q`
      select 1 from quotations where ref = ${candidate} limit 1
    `) as unknown as Array<Record<string, unknown>>;
    if (existing.length === 0) return candidate;
    n++;
  }
  // Fall through: 50 consecutive collisions is unrealistic in practice, but
  // if it ever happens the INSERT will still hit the UNIQUE constraint and
  // surface a clear error to the caller.
  return `Q${userInitial}${dd}${mm}${yy}MT${n}`;
}

/**
 * Strip a trailing `R<digits>` / `D<digits>` so every draft/review anchors
 * to the ROOT active quotation. That way reviewing a draft still produces
 * QA140426MT5R1 (not QA140426MT5D2R1), keeping the REF chain readable.
 */
function rootOfRef(ref: string): string {
  return ref.replace(/(?:[RD])\d+$/, "");
}

/**
 * Mint a draft/review REF by appending `D<m>` or `R<m>` to the parent's
 * root REF. `m` is the 1-indexed count of existing drafts (or reviews)
 * that share the same root, so the first draft of QA140426MT5 is
 * QA140426MT5D1, the second is QA140426MT5D2, and so on.
 */
async function genSuffixedRef(
  q: Sql,
  parentRef: string,
  suffix: "R" | "D",
): Promise<string> {
  const root = rootOfRef(parentRef);
  // `ref like '<root><suffix>%'` catches every prior R1..Rn or D1..Dn for
  // this parent regardless of who created them — two users collaborating
  // on the same quotation still get a correctly-ordered review chain.
  const pattern = `${root}${suffix}%`;
  const countRows = (await q`
    select count(*)::int as c from quotations
    where ref like ${pattern}
  `) as Array<{ c: number }>;
  let m = (countRows[0]?.c ?? 0) + 1;

  for (let attempts = 0; attempts < 50; attempts++) {
    const candidate = `${root}${suffix}${m}`;
    const existing = (await q`
      select 1 from quotations where ref = ${candidate} limit 1
    `) as unknown as Array<Record<string, unknown>>;
    if (existing.length === 0) return candidate;
    m++;
  }
  return `${root}${suffix}${m}`;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const contactIdParam = searchParams.get("contact_id");
    const q = sql();
    if (id) {
      // Single-row lookup. Historically this returned even trashed rows so
      // the trash UI could build a preview; now that the Quotation Viewer
      // page fetches the row through this endpoint (instead of doing a
      // server-component DB query), we also have to enforce the
      // deleted_at filter and the owner check here. Regular users can
      // only read their own quotations; admins can read any row.
      const rows = (await q`
        select id, ref, owner_id, project_name, client_name, client_email,
               client_phone, sales_engineer, prepared_by, tax_percent,
               site_name, items_json, config_json, folder_id, contact_id,
               status, parent_ref, created_at, updated_at, deleted_at
        from quotations
        where id = ${Number(id)}
        limit 1
      `) as Array<Record<string, unknown>>;
      const row = rows[0];
      if (!row) {
        return NextResponse.json({ quotation: null });
      }
      if (row.deleted_at) {
        // Trashed rows never leak through the viewer path. The dedicated
        // `/api/trash` endpoint is the only surface that hands out
        // soft-deleted quotations.
        return NextResponse.json({ quotation: null });
      }
      if (user.role !== "admin" && Number(row.owner_id) !== user.id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      return NextResponse.json({ quotation: row });
    }
    // Per-contact list. Used by CompanyDetail to render each person's
    // quotations underneath their card. Owner-isolated for non-admins so a
    // shared contact_id never leaks rows across users.
    if (contactIdParam) {
      const contactId = Number(contactIdParam);
      if (!Number.isFinite(contactId) || contactId <= 0) {
        return NextResponse.json({ quotations: [] });
      }
      const contactRows =
        user.role === "admin"
          ? ((await q`
              select id, ref, project_name, client_name, site_name,
                     folder_id, contact_id, owner_id, status, parent_ref,
                     created_at, updated_at
              from quotations
              where contact_id = ${contactId} and deleted_at is null
              order by id desc
              limit 200
            `) as Array<Record<string, unknown>>)
          : ((await q`
              select id, ref, project_name, client_name, site_name,
                     folder_id, contact_id, owner_id, status, parent_ref,
                     created_at, updated_at
              from quotations
              where contact_id = ${contactId}
                and owner_id = ${user.id}
                and deleted_at is null
              order by id desc
              limit 200
            `) as Array<Record<string, unknown>>);
      return NextResponse.json({ quotations: contactRows });
    }

    const rows =
      user.role === "admin"
        ? ((await q`
            select q.id, q.ref, q.project_name, q.client_name, q.site_name,
                   q.folder_id, q.contact_id, q.owner_id, q.status, q.parent_ref,
                   q.created_at, q.updated_at,
                   u.username as owner_username,
                   u.display_name as owner_display_name
            from quotations q
            left join users u on u.id = q.owner_id
            where q.deleted_at is null
            order by q.id desc
            limit 500
          `) as Array<Record<string, unknown>>)
        : ((await q`
            select id, ref, project_name, client_name, site_name,
                   folder_id, contact_id, owner_id, status, parent_ref,
                   created_at, updated_at
            from quotations
            where owner_id = ${user.id}
              and deleted_at is null
            order by id desc
            limit 200
          `) as Array<Record<string, unknown>>);
    // `private, max-age=5` gives us near-instant reloads without hiding
    // freshly-saved rows for more than a few seconds. The "new quotation
    // missing from the list" bug that this file briefly fought with
    // `no-store` is already handled by `router.refresh()` in Designer's
    // save handler — that invalidates the Next.js RSC cache so the server
    // component requeries the DB directly on the next navigation, which
    // means the HTTP cache header only matters for the rare client-side
    // fallback path. Keeping a small window of caching here is the
    // difference between a warm page feeling instant and every single
    // navigation sitting on a fresh Supabase round-trip.
    return NextResponse.json(
      { quotations: rows },
      {
        headers: {
          "Cache-Control": "private, max-age=5, stale-while-revalidate=30",
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }
    const body = (await req.json()) as {
      ref?: string;
      project_name?: string;
      client_name?: string | null;
      client_email?: string | null;
      client_phone?: string | null;
      sales_engineer?: string | null;
      prepared_by?: string | null;
      site_name?: string;
      tax_percent?: number;
      items?: unknown[];
      totals?: Record<string, unknown>;
      config?: Record<string, unknown>;
      folder_id?: number | null;
      contact_id?: number | null;
    };
    const q = sql();
    const existingRows = (await q`
      select * from quotations
      where id = ${id} and deleted_at is null
      limit 1
    `) as Array<Record<string, unknown>>;
    if (existingRows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const existing = existingRows[0];
    if (user.role !== "admin" && existing.owner_id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // If the caller is moving the quotation into a folder, make sure the
    // target folder belongs to the quotation's owner (admins are exempt).
    if (
      user.role !== "admin" &&
      body.folder_id !== undefined &&
      body.folder_id !== null
    ) {
      const folderRows = (await q`
        select owner_id from client_folders
        where id = ${body.folder_id} and deleted_at is null
        limit 1
      `) as Array<{ owner_id: number | null }>;
      if (folderRows.length === 0) {
        return NextResponse.json({ error: "folder not found" }, { status: 404 });
      }
      if (folderRows[0].owner_id !== user.id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }

    // Same owner check for the contact link, so a user can't attribute their
    // quotation to a person they don't own. Admins skip the check.
    if (
      user.role !== "admin" &&
      body.contact_id !== undefined &&
      body.contact_id !== null
    ) {
      const contactRows = (await q`
        select owner_id from contacts
        where id = ${body.contact_id} and deleted_at is null
        limit 1
      `) as Array<{ owner_id: number | null }>;
      if (contactRows.length === 0) {
        return NextResponse.json({ error: "contact not found" }, { status: 404 });
      }
      if (contactRows[0].owner_id !== user.id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }

    // Only touch columns that the caller explicitly sent. The previous
    // implementation read `existing.*` and re-wrote every column, which
    // was catastrophic for jsonb fields: the round-trip
    //   postgres → JS value → JSON.stringify(...) → ::jsonb
    // is fragile, and for callers like MoveToFolder (which sends only
    // { folder_id }) it silently rewrote items_json / totals_json /
    // config_json with a possibly-empty or corrupted round-trip, wiping
    // saved quotations. This build-only-what-changed approach makes the
    // jsonb columns untouched unless the client actually sent new values.
    const ref = body.ref !== undefined ? body.ref : existing.ref;
    const pn =
      body.project_name !== undefined ? body.project_name : existing.project_name;
    const cn =
      body.client_name !== undefined ? body.client_name : existing.client_name;
    const ce =
      body.client_email !== undefined ? body.client_email : existing.client_email;
    const cp =
      body.client_phone !== undefined ? body.client_phone : existing.client_phone;
    const se =
      body.sales_engineer !== undefined
        ? body.sales_engineer
        : existing.sales_engineer;
    const pb =
      body.prepared_by !== undefined ? body.prepared_by : existing.prepared_by;
    const sn = body.site_name !== undefined ? body.site_name : existing.site_name;
    const tp = Number(
      body.tax_percent !== undefined ? body.tax_percent : existing.tax_percent,
    );
    const fid =
      body.folder_id !== undefined ? body.folder_id : existing.folder_id;
    const cid =
      body.contact_id !== undefined ? body.contact_id : existing.contact_id;

    const hasItems = body.items !== undefined;
    const hasTotals = body.totals !== undefined;
    const hasConfig = body.config !== undefined;

    // Serialize jsonb payloads up-front. When the client did not send a
    // jsonb field, we pass a benign `'null'` literal and the UPDATE's
    // CASE guard keeps the existing column value — PostgreSQL CASE
    // short-circuits so the placeholder is never actually evaluated.
    // `'null'::jsonb` is a valid cast just in case that guarantee slips.
    const itemsText = hasItems ? JSON.stringify(body.items) : "null";
    const totalsText = hasTotals ? JSON.stringify(body.totals) : "null";
    const configText = hasConfig ? JSON.stringify(body.config) : "null";

    const rows = (await q`
      update quotations set
        ref            = ${ref as string},
        project_name   = ${pn as string},
        client_name    = ${cn as string | null},
        client_email   = ${ce as string | null},
        client_phone   = ${cp as string | null},
        sales_engineer = ${se as string | null},
        prepared_by    = ${pb as string | null},
        site_name      = ${sn as string},
        tax_percent    = ${tp},
        items_json     = case when ${hasItems} then ${itemsText}::jsonb else items_json end,
        totals_json    = case when ${hasTotals} then ${totalsText}::jsonb else totals_json end,
        config_json    = case when ${hasConfig} then ${configText}::jsonb else config_json end,
        folder_id      = ${fid as number | null},
        contact_id     = ${cid as number | null},
        updated_at     = now()
      where id = ${id}
      returning id, ref
    `) as unknown as Array<{ id: number; ref: string }>;
    return NextResponse.json({ quotation: rows[0] });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const body = (await req.json()) as {
      ref?: string;
      /**
       * Quotation kind. 'active' (default) is a brand-new record that bumps
       * the user's per-user counter and gets a plain QY<DDMMYY>MT<n> ref.
       * 'draft' / 'review' are snapshots anchored to an existing active
       * quotation identified by `parent_id` (preferred) or `parent_ref`.
       */
      mode?: QuotationMode;
      parent_id?: number;
      parent_ref?: string;
      project_name: string;
      client_name?: string;
      client_email?: string;
      client_phone?: string;
      sales_engineer?: string;
      prepared_by?: string;
      site_name?: string;
      tax_percent?: number;
      items: unknown[];
      totals?: Record<string, unknown>;
      config?: Record<string, unknown>;
      folder_id?: number | null;
      contact_id?: number | null;
    };

    const mode: QuotationMode =
      body.mode === "draft" || body.mode === "review" ? body.mode : "active";

    const q = sql();

    // ── Resolve parent for draft / review snapshots ─────────────────────────
    let parentRef: string | null = null;
    if (mode !== "active") {
      if (body.parent_id) {
        const parentRows = (await q`
          select id, ref, owner_id, deleted_at from quotations
          where id = ${body.parent_id}
          limit 1
        `) as Array<{
          id: number;
          ref: string;
          owner_id: number | null;
          deleted_at: unknown;
        }>;
        if (parentRows.length === 0 || parentRows[0].deleted_at) {
          return NextResponse.json(
            { error: "parent quotation not found" },
            { status: 404 },
          );
        }
        if (
          user.role !== "admin" &&
          parentRows[0].owner_id !== null &&
          parentRows[0].owner_id !== user.id
        ) {
          return NextResponse.json(
            { error: "forbidden parent" },
            { status: 403 },
          );
        }
        parentRef = parentRows[0].ref;
      } else if (body.parent_ref && body.parent_ref.trim()) {
        parentRef = body.parent_ref.trim();
      } else {
        return NextResponse.json(
          { error: "parent_id or parent_ref required for draft/review" },
          { status: 400 },
        );
      }
    }

    // ── Mint the REF ────────────────────────────────────────────────────────
    // Honour an explicit ref only for 'active' — drafts/reviews must derive
    // their ref from the parent so the D<m>/R<m> counter stays correct.
    let ref: string;
    if (mode === "active" && body.ref && body.ref.trim()) {
      ref = body.ref.trim();
    } else if (mode === "active") {
      const initial = ownerInitial(user.display_name, user.username);
      ref = await genActiveRef(q, initial, user.id);
    } else {
      ref = await genSuffixedRef(
        q,
        parentRef as string,
        mode === "review" ? "R" : "D",
      );
    }

    const folderId = body.folder_id || null;
    const contactId = body.contact_id ?? null;
    // Owner check on the linked contact for non-admins. Same shape as the
    // PATCH path: refuses an unknown id or one belonging to another user.
    if (user.role !== "admin" && contactId !== null) {
      const contactRows = (await q`
        select owner_id from contacts
        where id = ${contactId} and deleted_at is null
        limit 1
      `) as Array<{ owner_id: number | null }>;
      if (contactRows.length === 0) {
        return NextResponse.json({ error: "contact not found" }, { status: 404 });
      }
      if (contactRows[0].owner_id !== user.id) {
        return NextResponse.json({ error: "forbidden contact" }, { status: 403 });
      }
    }
    // Folder selection is the CRM anchor: the client_* fields are sourced
    // from the folder unless the caller explicitly sent overrides. This is
    // what lets Designer.tsx present a UI where the user only types the
    // project name — the server still guarantees the persisted row matches
    // the folder so print output stays consistent.
    let folderClientName: string | null = null;
    let folderClientEmail: string | null = null;
    let folderClientPhone: string | null = null;
    if (folderId) {
      const folderRows = (await q`
        select owner_id, name, client_email, client_phone
        from client_folders
        where id = ${folderId} and deleted_at is null
        limit 1
      `) as Array<{
        owner_id: number | null;
        name: string;
        client_email: string | null;
        client_phone: string | null;
      }>;
      if (folderRows.length === 0) {
        return NextResponse.json({ error: "folder not found" }, { status: 404 });
      }
      if (user.role !== "admin" && folderRows[0].owner_id !== user.id) {
        return NextResponse.json({ error: "forbidden folder" }, { status: 403 });
      }
      folderClientName = folderRows[0].name || null;
      folderClientEmail = folderRows[0].client_email;
      folderClientPhone = folderRows[0].client_phone;
    }

    // Caller-provided values win; fall back to the folder's CRM data; finally
    // null. `body.client_name === ""` is treated as "no value given" so the
    // folder name always surfaces when Designer omits the field.
    const clientName =
      (body.client_name && body.client_name.trim()) || folderClientName;
    const clientEmail =
      (body.client_email && body.client_email.trim()) || folderClientEmail;
    const clientPhone =
      (body.client_phone && body.client_phone.trim()) || folderClientPhone;

    // Drafts/reviews persist the root parent ref so the chain is queryable
    // directly. Active rows keep parent_ref NULL.
    const storedParentRef =
      mode === "active" ? null : rootOfRef(parentRef as string);

    const rows = (await q`
      insert into quotations (
        ref, owner_id, project_name, client_name, client_email, client_phone,
        sales_engineer, prepared_by, site_name, tax_percent, items_json,
        totals_json, config_json, folder_id, contact_id, status, parent_ref
      ) values (
        ${ref}, ${user.id}, ${body.project_name}, ${clientName},
        ${clientEmail}, ${clientPhone},
        ${body.sales_engineer || null}, ${body.prepared_by || user.username},
        ${body.site_name || "SITE"}, ${body.tax_percent ?? 16},
        ${JSON.stringify(body.items || [])}::jsonb,
        ${JSON.stringify(body.totals || {})}::jsonb,
        ${JSON.stringify(body.config || {})}::jsonb,
        ${folderId}, ${contactId}, ${mode}, ${storedParentRef}
      )
      returning id, ref, status, parent_ref
    `) as Array<{
      id: number;
      ref: string;
      status: string;
      parent_ref: string | null;
    }>;
    return NextResponse.json({ quotation: rows[0] });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * Soft-delete a quotation. The row stays in the database with `deleted_at`
 * populated so the trash UI can restore it. We never offer a permanent-
 * delete endpoint — the junction box is forever.
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }
    const q = sql();
    const owned = (await q`
      select owner_id from quotations
      where id = ${id} and deleted_at is null
      limit 1
    `) as Array<{ owner_id: number | null }>;
    if (owned.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (user.role !== "admin" && owned[0].owner_id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    await q`
      update quotations set deleted_at = now(), updated_at = now()
      where id = ${id}
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
