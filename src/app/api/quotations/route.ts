import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { requireModuleAllowLegacy } from "@/lib/modules";
import { ensureDefaultProject } from "@/lib/projects";
import { d1Query, isD1Configured } from "@/lib/db-d1";
import { resolveR2OverflowsInRows } from "@/lib/r2";
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
 * Format: Q<L><MDDYY>MT<n>
 *   L   — first letter of the presales/assigned user's display name
 *   M   — month of creation (unpadded, so April → "4", October → "10")
 *   DD  — zero-padded day of month
 *   YY  — last two digits of the year
 *   MT  — literal, stands for Magic Technology
 *   n   — GLOBAL incremental counter. Picks the lowest positive integer
 *         that no live active quotation currently holds. Counters held
 *         only by soft-deleted rows are freed for reuse so a "test"
 *         quotation that lands in the trash doesn't leave a gap.
 *
 * Drafts and reviews never mint a new `n`; they inherit the parent's
 * counter and append D<m> / R<m> suffixes via {@link genSuffixedRef}.
 *
 * Implementation notes:
 *   - We scan the `MT(\d+)` tail across every non-deleted row (active,
 *     draft and review alike), so a live draft of QA42226MT5 still
 *     reserves the counter 5 until the root active is retired. The
 *     collision probe below is the real safety net — the unique index
 *     on `ref` is the source of truth and catches races.
 *   - Today's example: user "Yasmine" on April 22, 2026, first quotation
 *     of the day in a fresh DB → `QY42226MT1`; the next new one the same
 *     day (or next day, different user) becomes `...MT2`.
 */
async function genActiveRef(
  useD1: boolean,
  q: Sql | null,
  userInitial: string,
): Promise<string> {
  const d = new Date();
  const m = String(d.getMonth() + 1); // unpadded month, e.g. "4" or "10"
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const datePart = `${m}${dd}${yy}`;

  // Every live (non-deleted) ref, regardless of status. Soft-deleted rows
  // are excluded so their counters become reusable.
  let rows: Array<{ ref: string }>;
  if (useD1) {
    const result = await d1Query<{ ref: string }>(
      `select ref from quotations where deleted_at is null`,
    );
    rows = result.results;
  } else {
    rows = (await q!`
      select ref from quotations
      where deleted_at is null
    `) as Array<{ ref: string }>;
  }

  const used = new Set<number>();
  for (const { ref } of rows) {
    const match = /MT(\d+)/.exec(ref || "");
    if (match) used.add(Number(match[1]));
  }

  // Lowest unused positive integer.
  let n = 1;
  while (used.has(n)) n++;

  // Collision probe. The unique index on `ref` is authoritative; this
  // pre-check just avoids a failed INSERT round-trip if two requests
  // race on the same counter, and also skips counters that exist on a
  // soft-deleted row of the same date (we'd generate the same full ref
  // and hit the unique constraint).
  for (let attempts = 0; attempts < 100; attempts++) {
    const candidate = `Q${userInitial}${datePart}MT${n}`;
    let existing: Array<Record<string, unknown>>;
    if (useD1) {
      const result = await d1Query<Record<string, unknown>>(
        `select 1 from quotations where ref = ? limit 1`,
        [candidate],
      );
      existing = result.results;
    } else {
      existing = (await q!`
        select 1 from quotations where ref = ${candidate} limit 1
      `) as unknown as Array<Record<string, unknown>>;
    }
    if (existing.length === 0) return candidate;
    n++;
  }
  // Fall through: 100 consecutive collisions would mean every low integer
  // is taken on this exact date+initial; hand the highest candidate back
  // and let the unique index surface the error to the caller.
  return `Q${userInitial}${datePart}MT${n}`;
}

/**
 * Strip a trailing `R<digits>` / `D<digits>` so every draft/review anchors
 * to the ROOT active quotation. That way reviewing a draft still produces
 * QA42226MT5R1 (not QA42226MT5D2R1), keeping the REF chain readable.
 */
function rootOfRef(ref: string): string {
  return ref.replace(/(?:[RD])\d+$/, "");
}

/**
 * Mint a draft/review REF by appending `D<m>` or `R<m>` to the parent's
 * root REF. `m` is the 1-indexed count of existing drafts (or reviews)
 * that share the same root, so the first draft of QA42226MT5 is
 * QA42226MT5D1, the second is QA42226MT5D2, and so on.
 */
async function genSuffixedRef(
  useD1: boolean,
  q: Sql | null,
  parentRef: string,
  suffix: "R" | "D",
): Promise<string> {
  const root = rootOfRef(parentRef);
  // Fetch all refs and do pattern matching in JS to avoid SQLite LIKE issues
  let allRefs: Array<{ ref: string }>;
  if (useD1) {
    const result = await d1Query<{ ref: string }>(
      `select ref from quotations where deleted_at is null`,
    );
    allRefs = result.results;
  } else {
    allRefs = (await q!`
      select ref from quotations where deleted_at is null
    `) as Array<{ ref: string }>;
  }

  const pattern = new RegExp(`^${root}${suffix}(\\d+)$`);
  let maxM = 0;
  for (const { ref } of allRefs) {
    const match = pattern.exec(ref || "");
    if (match) {
      const m = Number(match[1]);
      if (m > maxM) maxM = m;
    }
  }
  let m = maxM + 1;

  for (let attempts = 0; attempts < 50; attempts++) {
    const candidate = `${root}${suffix}${m}`;
    let existing: Array<Record<string, unknown>>;
    if (useD1) {
      const result = await d1Query<Record<string, unknown>>(
        `select 1 from quotations where ref = ? limit 1`,
        [candidate],
      );
      existing = result.results;
    } else {
      existing = (await q!`
        select 1 from quotations where ref = ${candidate} limit 1
      `) as unknown as Array<Record<string, unknown>>;
    }
    if (existing.length === 0) return candidate;
    m++;
  }
  return `${root}${suffix}${m}`;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await requireModuleAllowLegacy(user, "crm");
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const contactIdParam = searchParams.get("contact_id");
    const folderIdParam = searchParams.get("folder_id");

    const useD1 = isD1Configured();
    const q = useD1 ? null : sql();

    if (id) {
      // Single-row lookup. Historically this returned even trashed rows so
      // the trash UI could build a preview; now that the Quotation Viewer
      // page fetches the row through this endpoint (instead of doing a
      // server-component DB query), we also have to enforce the
      // deleted_at filter and the owner check here. Regular users can
      // only read their own quotations; admins can read any row.
      let rows: Array<Record<string, unknown>>;
      if (useD1) {
        const result = await d1Query<Record<string, unknown>>(
          `select id, ref, owner_id, project_name, client_name, client_email,
                  client_phone, sales_engineer, prepared_by, tax_percent,
                  site_name, items_json, config_json, folder_id, contact_id,
                  project_id,
                  status, parent_ref, created_at, updated_at, deleted_at
           from quotations
           where id = ?
           limit 1`,
          [Number(id)],
        );
        rows = result.results;
        // Resolve R2 overflows in items_json if present
        if (rows.length > 0) {
          rows = await resolveR2OverflowsInRows(rows, ["items_json"]);
        }
      } else {
        rows = (await q!`
          select id, ref, owner_id, project_name, client_name, client_email,
                 client_phone, sales_engineer, prepared_by, tax_percent,
                 site_name, items_json, config_json, folder_id, contact_id,
                 project_id,
                 status, parent_ref, created_at, updated_at, deleted_at
          from quotations
          where id = ${Number(id)}
          limit 1
        `) as Array<Record<string, unknown>>;
      }
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
      if (!canReadAll(user) && Number(row.owner_id) !== user.id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      return NextResponse.json({ quotation: row });
    }
    // Per-project list. Drives the Files / Quotations tab inside the
    // Project page: every quotation filed under a given project_id, or
    // a project_id of 0 / 'unfiled' to surface legacy rows that pre-
    // date the projects layer. Owner-isolation matches the general
    // list. Reads ?project_id=&lt;n&gt;.
    const projectIdParam = req.nextUrl.searchParams.get("project_id");
    if (projectIdParam) {
      const projectId = Number(projectIdParam);
      if (!Number.isFinite(projectId) || projectId <= 0) {
        return NextResponse.json({ quotations: [] });
      }
      let projectRows: Array<Record<string, unknown>>;
      if (useD1) {
        if (canReadAll(user)) {
          const result = await d1Query<Record<string, unknown>>(
            `select id, ref, project_name, client_name, site_name,
                    folder_id, contact_id, project_id, owner_id, status, parent_ref,
                    created_at, updated_at
             from quotations
             where project_id = ? and deleted_at is null
             order by id desc
             limit 500`,
            [projectId],
          );
          projectRows = result.results;
        } else {
          const result = await d1Query<Record<string, unknown>>(
            `select id, ref, project_name, client_name, site_name,
                    folder_id, contact_id, project_id, owner_id, status, parent_ref,
                    created_at, updated_at
             from quotations
             where project_id = ? and owner_id = ? and deleted_at is null
             order by id desc
             limit 500`,
            [projectId, user.id],
          );
          projectRows = result.results;
        }
      } else {
        projectRows =
          canReadAll(user)
            ? ((await q!`
                select id, ref, project_name, client_name, site_name,
                       folder_id, contact_id, project_id, owner_id, status, parent_ref,
                       created_at, updated_at
                from quotations
                where project_id = ${projectId} and deleted_at is null
                order by id desc
                limit 500
              `) as Array<Record<string, unknown>>)
            : ((await q!`
                select id, ref, project_name, client_name, site_name,
                       folder_id, contact_id, project_id, owner_id, status, parent_ref,
                       created_at, updated_at
                from quotations
                where project_id = ${projectId}
                  and owner_id = ${user.id}
                  and deleted_at is null
                order by id desc
                limit 500
              `) as Array<Record<string, unknown>>);
      }
      return NextResponse.json({ quotations: projectRows });
    }

    // Per-folder list. Powers the Company page's "quotations for this
    // company" panel, which splits rows into assigned (shown under each
    // person) vs unassigned (offered in a reassignment dropdown). Uses the
    // same owner-isolation rule as the general list.
    if (folderIdParam) {
      const folderId = Number(folderIdParam);
      if (!Number.isFinite(folderId) || folderId <= 0) {
        return NextResponse.json({ quotations: [] });
      }
      let folderRows: Array<Record<string, unknown>>;
      if (useD1) {
        if (canReadAll(user)) {
          const result = await d1Query<Record<string, unknown>>(
            `select id, ref, project_name, client_name, site_name,
                    folder_id, contact_id, project_id, owner_id, status, parent_ref,
                    created_at, updated_at
             from quotations
             where folder_id = ? and deleted_at is null
             order by id desc
             limit 500`,
            [folderId],
          );
          folderRows = result.results;
        } else {
          const result = await d1Query<Record<string, unknown>>(
            `select id, ref, project_name, client_name, site_name,
                    folder_id, contact_id, project_id, owner_id, status, parent_ref,
                    created_at, updated_at
             from quotations
             where folder_id = ? and owner_id = ? and deleted_at is null
             order by id desc
             limit 500`,
            [folderId, user.id],
          );
          folderRows = result.results;
        }
      } else {
        folderRows =
          canReadAll(user)
            ? ((await q!`
                select id, ref, project_name, client_name, site_name,
                       folder_id, contact_id, project_id, owner_id, status, parent_ref,
                       created_at, updated_at
                from quotations
                where folder_id = ${folderId} and deleted_at is null
                order by id desc
                limit 500
              `) as Array<Record<string, unknown>>)
            : ((await q!`
                select id, ref, project_name, client_name, site_name,
                       folder_id, contact_id, project_id, owner_id, status, parent_ref,
                       created_at, updated_at
                from quotations
                where folder_id = ${folderId}
                  and owner_id = ${user.id}
                  and deleted_at is null
                order by id desc
                limit 500
              `) as Array<Record<string, unknown>>);
      }
      return NextResponse.json({ quotations: folderRows });
    }

    // Per-contact list. Used by CompanyDetail to render each person's
    // quotations underneath their card. Owner-isolated for non-admins so a
    // shared contact_id never leaks rows across users.
    if (contactIdParam) {
      const contactId = Number(contactIdParam);
      if (!Number.isFinite(contactId) || contactId <= 0) {
        return NextResponse.json({ quotations: [] });
      }
      let contactRows: Array<Record<string, unknown>>;
      if (useD1) {
        if (canReadAll(user)) {
          const result = await d1Query<Record<string, unknown>>(
            `select id, ref, project_name, client_name, site_name,
                    folder_id, contact_id, owner_id, status, parent_ref,
                    created_at, updated_at
             from quotations
             where contact_id = ? and deleted_at is null
             order by id desc
             limit 200`,
            [contactId],
          );
          contactRows = result.results;
        } else {
          const result = await d1Query<Record<string, unknown>>(
            `select id, ref, project_name, client_name, site_name,
                    folder_id, contact_id, owner_id, status, parent_ref,
                    created_at, updated_at
             from quotations
             where contact_id = ? and owner_id = ? and deleted_at is null
             order by id desc
             limit 200`,
            [contactId, user.id],
          );
          contactRows = result.results;
        }
      } else {
        contactRows =
          canReadAll(user)
            ? ((await q!`
                select id, ref, project_name, client_name, site_name,
                       folder_id, contact_id, owner_id, status, parent_ref,
                       created_at, updated_at
                from quotations
                where contact_id = ${contactId} and deleted_at is null
                order by id desc
                limit 200
              `) as Array<Record<string, unknown>>)
            : ((await q!`
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
      }
      return NextResponse.json({ quotations: contactRows });
    }

    let rows: Array<Record<string, unknown>>;
    if (useD1) {
      if (canReadAll(user)) {
        // D1 doesn't support JOIN; fetch quotations and optionally fetch users separately if needed
        const result = await d1Query<Record<string, unknown>>(
          `select id, ref, project_name, client_name, site_name,
                  folder_id, contact_id, owner_id, status, parent_ref,
                  created_at, updated_at
           from quotations
           where deleted_at is null
           order by id desc
           limit 500`,
        );
        rows = result.results;
      } else {
        const result = await d1Query<Record<string, unknown>>(
          `select id, ref, project_name, client_name, site_name,
                  folder_id, contact_id, owner_id, status, parent_ref,
                  created_at, updated_at
           from quotations
           where owner_id = ? and deleted_at is null
           order by id desc
           limit 200`,
          [user.id],
        );
        rows = result.results;
      }
    } else {
      rows =
        canReadAll(user)
          ? ((await q!`
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
          : ((await q!`
              select id, ref, project_name, client_name, site_name,
                     folder_id, contact_id, owner_id, status, parent_ref,
                     created_at, updated_at
              from quotations
              where owner_id = ${user.id}
                and deleted_at is null
              order by id desc
              limit 200
            `) as Array<Record<string, unknown>>);
    }
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
    await requireModuleAllowLegacy(user, "crm");
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
      project_id?: number | null;
    };
    const useD1 = isD1Configured();
    const q = useD1 ? null : sql();
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

    // Verify project ownership when the caller is reassigning the quotation
    // to a different project. Mirrors the folder-ownership guard below so a
    // user can never plant a quotation under another user's project.
    if (
      user.role !== "admin" &&
      body.project_id !== undefined &&
      body.project_id !== null
    ) {
      const projectRows = (await q`
        select owner_id, folder_id from projects
        where id = ${body.project_id} and deleted_at is null
        limit 1
      `) as Array<{ owner_id: number | null; folder_id: number | null }>;
      if (projectRows.length === 0) {
        return NextResponse.json(
          { error: "project not found" },
          { status: 404 },
        );
      }
      if (projectRows[0].owner_id !== user.id) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
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
    const pid =
      body.project_id !== undefined ? body.project_id : existing.project_id;

    const hasItems = body.items !== undefined;
    const hasTotals = body.totals !== undefined;
    const hasConfig = body.config !== undefined;

    // Serialize jsonb payloads up-front. When the client did not send a
    // jsonb field, we pass a benign `'null'` literal and the UPDATE's
    // CASE guard keeps the existing column value — PostgreSQL CASE
    // short-circuits so the placeholder is never actually evaluated.
    // `'null'::jsonb` is a valid cast just in case that guarantee slips.
    const itemsText = hasItems ? JSON.stringify(body.items) : null;
    const totalsText = hasTotals ? JSON.stringify(body.totals) : null;
    const configText = hasConfig ? JSON.stringify(body.config) : null;

    let rows: Array<{ id: number; ref: string }>;
    if (useD1) {
      const nowIso = new Date().toISOString();
      const result = await d1Query<{ id: number; ref: string }>(
        `update quotations set
          ref = ?, project_name = ?, client_name = ?, client_email = ?,
          client_phone = ?, sales_engineer = ?, prepared_by = ?,
          site_name = ?, tax_percent = ?,
          items_json = coalesce(?, items_json),
          totals_json = coalesce(?, totals_json),
          config_json = coalesce(?, config_json),
          folder_id = ?, contact_id = ?, project_id = ?,
          updated_at = ?
         where id = ? returning id, ref`,
        [
          ref,
          pn,
          cn,
          ce,
          cp,
          se,
          pb,
          sn,
          tp,
          itemsText,
          totalsText,
          configText,
          fid,
          cid,
          pid,
          nowIso,
          id,
        ],
      );
      rows = result.results;
    } else {
      const itemsTextPg = hasItems ? JSON.stringify(body.items) : "null";
      const totalsTextPg = hasTotals ? JSON.stringify(body.totals) : "null";
      const configTextPg = hasConfig ? JSON.stringify(body.config) : "null";
      rows = (await q!`
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
          items_json     = case when ${hasItems} then ${itemsTextPg}::jsonb else items_json end,
          totals_json    = case when ${hasTotals} then ${totalsTextPg}::jsonb else totals_json end,
          config_json    = case when ${hasConfig} then ${configTextPg}::jsonb else config_json end,
          folder_id      = ${fid as number | null},
          contact_id     = ${cid as number | null},
          project_id     = ${pid as number | null},
          updated_at     = now()
        where id = ${id}
        returning id, ref
      `) as unknown as Array<{ id: number; ref: string }>;
    }
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
    await requireModuleAllowLegacy(user, "crm");
    await ensureSchema();
    const body = (await req.json()) as {
      ref?: string;
      /**
       * Quotation kind. 'active' (default) is a brand-new record that
       * claims the next free slot in the global counter and gets a plain
       * QY<MDDYY>MT<n> ref. 'draft' / 'review' are snapshots anchored to
       * an existing active quotation identified by `parent_id`
       * (preferred) or `parent_ref`.
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
      project_id?: number | null;
    };

    const mode: QuotationMode =
      body.mode === "draft" || body.mode === "review" ? body.mode : "active";

    const useD1 = isD1Configured();
    const q = useD1 ? null : sql();

    // ── Resolve parent for draft / review snapshots ─────────────────────────
    let parentRef: string | null = null;
    let parentProjectId: number | null = null;
    if (mode !== "active") {
      if (body.parent_id) {
        const parentRows = (await q`
          select id, ref, owner_id, project_id, deleted_at from quotations
          where id = ${body.parent_id}
          limit 1
        `) as Array<{
          id: number;
          ref: string;
          owner_id: number | null;
          project_id: number | null;
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
        // Inherit the parent's project so a draft / review snapshot
        // lands inside the same project as the original quotation.
        parentProjectId = parentRows[0].project_id ?? null;
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
      ref = await genActiveRef(useD1, q, initial);
    } else {
      ref = await genSuffixedRef(
        useD1,
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

    // Resolve the project the new row belongs to. Drafts/reviews inherit
    // from the parent unless the client explicitly overrides; active
    // quotations take whatever the caller sent (or NULL if omitted, in
    // which case the row appears as "Unfiled" in the project UI). When
    // the caller sends an explicit project_id, validate ownership for
    // non-admins so a malicious caller can't park a row under another
    // user's project.
    let projectId: number | null = null;
    if (body.project_id !== undefined && body.project_id !== null) {
      const projectRows = (await q`
        select owner_id from projects
        where id = ${body.project_id} and deleted_at is null
        limit 1
      `) as Array<{ owner_id: number | null }>;
      if (projectRows.length === 0) {
        return NextResponse.json(
          { error: "project not found" },
          { status: 404 },
        );
      }
      if (
        user.role !== "admin" &&
        projectRows[0].owner_id !== user.id
      ) {
        return NextResponse.json(
          { error: "forbidden project" },
          { status: 403 },
        );
      }
      projectId = body.project_id;
    } else if (mode !== "active") {
      projectId = parentProjectId;
    } else if (folderId !== null) {
      // Active quotation with no explicit project: drop it onto the
      // folder's Default Project so the project view never shows it as
      // "Unfiled". Creates the Default Project on the fly if the folder
      // doesn't have one yet (older folders that pre-date this rule).
      projectId = await ensureDefaultProject({
        folderId,
        ownerId: user.id,
      });
    }

    let rows: Array<{
      id: number;
      ref: string;
      status: string;
      parent_ref: string | null;
    }>;
    if (useD1) {
      const nowIso = new Date().toISOString();
      const result = await d1Query<{
        id: number;
        ref: string;
        status: string;
        parent_ref: string | null;
      }>(
        `insert into quotations (
          ref, owner_id, project_name, client_name, client_email, client_phone,
          sales_engineer, prepared_by, site_name, tax_percent, items_json,
          totals_json, config_json, folder_id, contact_id, project_id,
          status, parent_ref, custom_fields, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        returning id, ref, status, parent_ref`,
        [
          ref,
          user.id,
          body.project_name,
          clientName,
          clientEmail,
          clientPhone,
          body.sales_engineer || null,
          body.prepared_by || user.username,
          body.site_name || "SITE",
          body.tax_percent ?? 16,
          JSON.stringify(body.items || []),
          JSON.stringify(body.totals || {}),
          JSON.stringify(body.config || {}),
          folderId,
          contactId,
          projectId,
          mode,
          storedParentRef,
          "{}",
          nowIso,
          nowIso,
        ],
      );
      rows = result.results;
    } else {
      rows = (await q!`
        insert into quotations (
          ref, owner_id, project_name, client_name, client_email, client_phone,
          sales_engineer, prepared_by, site_name, tax_percent, items_json,
          totals_json, config_json, folder_id, contact_id, project_id,
          status, parent_ref
        ) values (
          ${ref}, ${user.id}, ${body.project_name}, ${clientName},
          ${clientEmail}, ${clientPhone},
          ${body.sales_engineer || null}, ${body.prepared_by || user.username},
          ${body.site_name || "SITE"}, ${body.tax_percent ?? 16},
          ${JSON.stringify(body.items || [])}::jsonb,
          ${JSON.stringify(body.totals || {})}::jsonb,
          ${JSON.stringify(body.config || {})}::jsonb,
          ${folderId}, ${contactId}, ${projectId},
          ${mode}, ${storedParentRef}
        )
        returning id, ref, status, parent_ref
      `) as Array<{
        id: number;
        ref: string;
        status: string;
        parent_ref: string | null;
      }>;
    }
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
    await requireModuleAllowLegacy(user, "crm");
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }
    const useD1 = isD1Configured();
    const q = useD1 ? null : sql();

    let owned: Array<{ owner_id: number | null }>;
    if (useD1) {
      const result = await d1Query<{ owner_id: number | null }>(
        `select owner_id from quotations where id = ? and deleted_at is null limit 1`,
        [id],
      );
      owned = result.results;
    } else {
      owned = (await q!`
        select owner_id from quotations
        where id = ${id} and deleted_at is null
        limit 1
      `) as Array<{ owner_id: number | null }>;
    }

    if (owned.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (user.role !== "admin" && owned[0].owner_id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    if (useD1) {
      const nowIso = new Date().toISOString();
      await d1Query(
        `update quotations set deleted_at = ?, updated_at = ? where id = ?`,
        [nowIso, nowIso, id],
      );
    } else {
      await q!`
        update quotations set deleted_at = now(), updated_at = now()
        where id = ${id}
      `;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
