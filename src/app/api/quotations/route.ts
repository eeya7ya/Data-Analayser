import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { quotationRefPrefix } from "@/lib/quotationRef";
import {
  requireModuleAllowLegacy,
  isSalesEditLocked,
  canAuthorQuotation,
} from "@/lib/modules";
import { ensureDefaultProject } from "@/lib/projects";
import {
  getLinkedProjectIds,
  userOwnsProjectOrLinked,
} from "@/lib/projectAccess";
import { d1Query } from "@/lib/db-d1";
import { resolveR2OverflowsInRows } from "@/lib/r2";
import { offloadImages } from "@/lib/imageOffload";
import type { Sql } from "postgres";

export const runtime = "nodejs";

type QuotationMode = "active" | "draft" | "review";

/**
 * Auto REF for a brand-new active quotation.
 *
 * Format: <DEPT>-FO<YY>-<HEX4>   e.g. ITD1-FO26-0001
 *   DEPT  — the author's admin-assigned department code (per user); "GEN"
 *           when the user has no code yet.
 *   FO    — literal, fixed.
 *   YY    — last two digits of the current year.
 *   HEX4  — incremental counter in uppercase hexadecimal, zero-padded to 4
 *           digits. Scoped PER DEPARTMENT and PER YEAR (both live in the
 *           prefix), so it restarts at 0001 each year for each department.
 *           Picks the lowest positive integer no live active quotation holds;
 *           counters held only by soft-deleted (trashed) rows are freed for
 *           reuse, so a deleted quotation's number is recycled.
 *
 * Drafts and reviews never mint a new counter; they inherit the parent's and
 * append `.D<m>` / `.R<m>` suffixes via {@link genSuffixedRef}. References are
 * minted for quotations only — leads have their own lifecycle and no REF.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 4-digit (min) uppercase hex, e.g. 1 → "0001", 4096 → "1000". */
function hex4(n: number): string {
  return n.toString(16).toUpperCase().padStart(4, "0");
}

async function genActiveRef(
  useD1: boolean,
  q: Sql | null,
  departmentCode: string,
  username: string,
): Promise<string> {
  // <DEPT+initials>-FO<YY>-<HEX4>, e.g. ITYA-FO26-0001 (department "ITD1",
  // author "Yahya" → "ITYA"). The HEX counter is scoped per prefix (department +
  // author) AND per calendar year, so it restarts at 0001 each year per author.
  // Soft-deleted rows free their counter, so deleted numbers are reused.
  const prefix = quotationRefPrefix(departmentCode, username);

  // Every live (non-deleted) ref. Soft-deleted rows are excluded so their
  // counters become reusable.
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

  // Collect used counters for THIS department + year. The counter is exactly
  // the 4 hex chars right after the prefix; draft/review refs append a
  // `.D<m>` / `.R<m>` suffix (the dot keeps them out of the hex run), and they
  // share their root's counter, so reading the leading 4 hex chars is correct.
  const used = new Set<number>();
  for (const { ref } of rows) {
    if (!ref || !ref.startsWith(prefix)) continue;
    const tail = ref.slice(prefix.length, prefix.length + 4);
    if (/^[0-9A-Fa-f]{4}$/.test(tail)) used.add(parseInt(tail, 16));
  }

  // Lowest unused positive integer.
  let n = 1;
  while (used.has(n)) n++;

  // Collision probe. The unique index on `ref` is authoritative; this
  // pre-check just avoids a failed INSERT round-trip if two requests race on
  // the same counter, and skips counters held by a soft-deleted row.
  for (let attempts = 0; attempts < 200; attempts++) {
    const candidate = `${prefix}${hex4(n)}`;
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
  return `${prefix}${hex4(n)}`;
}

/**
 * Strip a trailing `.R<digits>` / `.D<digits>` so every draft/review anchors
 * to the ROOT active quotation. That way reviewing a draft still produces
 * ITD1-FO26-0001.R1 (not ...0001.D2.R1), keeping the REF chain readable. The
 * leading `.` matters: the active counter is hex, and the digit `D` would
 * otherwise be ambiguous with the Draft suffix letter.
 */
function rootOfRef(ref: string): string {
  return ref.replace(/\.[RD]\d+$/, "");
}

/**
 * Mint a draft/review REF by appending `.D<m>` or `.R<m>` to the parent's
 * root REF. `m` is the 1-indexed count of existing drafts (or reviews) that
 * share the same root, so the first draft of ITD1-FO26-0001 is
 * ITD1-FO26-0001.D1, the second is ITD1-FO26-0001.D2, and so on.
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

  const pattern = new RegExp(`^${escapeRegExp(root)}\\.${suffix}(\\d+)$`);
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
    const candidate = `${root}.${suffix}${m}`;
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
  return `${root}.${suffix}${m}`;
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

    // D1 migration paused: Supabase is the single source of truth until
    // the dual-write divergence (review quotations missing from D1) is
    // reconciled. Flip back to isD1Configured() once D1 is re-synced.
    const useD1 = false;
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
                  status, parent_ref, created_at, updated_at, deleted_at,
                  exec_status, exec_submitted_at, exec_submitted_by,
                  exec_decided_at, exec_decided_by, exec_reject_reason
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
        // `select *` so every approval / handoff / outcome column flows to
        // QuotationViewer's approval bar. The earlier hand-rolled column
        // list silently dropped sales_approved_at / sent_to_sales_at and
        // friends, leaving the bar stuck on its initial "Awaiting sales
        // manager sign-off" state even after they were stamped.
        rows = (await q!`
          select * from quotations
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
        // The salesperson who raised the RFQ may VIEW (read-only) the
        // quotation presales built against it — matched via a lead they
        // created on the quotation's project. Editing stays owner/admin-only
        // (the PATCH path is unchanged), so this is genuinely view-only.
        const projId = row.project_id != null ? Number(row.project_id) : null;
        let isRequester = false;
        if (projId && q) {
          const r = (await q`
            select 1 from leads
            where created_by = ${user.id} and project_id = ${projId}
              and deleted_at is null
            limit 1
          `) as Array<{ "?column?": number }>;
          isRequester = r.length > 0;
        }
        if (!isRequester) {
          return NextResponse.json({ error: "forbidden" }, { status: 403 });
        }
      }
      // Contact card of the salesman who owns this quotation. The
      // Financial Proposal prints these under "Contact Details" so the
      // document always carries the owner's real email/phone from the
      // users table, not whoever happens to be viewing it.
      let owner: Record<string, unknown> | null = null;
      const ownerId = Number(row.owner_id);
      if (!useD1 && ownerId) {
        const ownerRows = (await q!`
          select username, display_name, phone, coalesce(email, '') as email
          from users where id = ${ownerId}
          limit 1
        `) as Array<Record<string, unknown>>;
        owner = ownerRows[0] ?? null;
      }
      return NextResponse.json({ quotation: row, owner });
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
        // Lead-linked surfacing: the salesperson's project and the presales
        // project of the SAME lead share one workspace, so a quotation
        // presales built under project Y shows (read-only) in the sales
        // project X's Quotations tab too — instead of "0 quotations". We
        // expand the owner-isolation to the linked set only when there IS a
        // link (and the caller is part of the deal), so a plain standalone
        // project keeps its exact prior owner-only behaviour.
        const linkedIds = await getLinkedProjectIds(projectId);
        const hasLink = linkedIds.length > 1;
        const sharesDeal =
          hasLink &&
          (canReadAll(user) ||
            (await userOwnsProjectOrLinked(projectId, user.id)));
        projectRows =
          canReadAll(user) || sharesDeal
            ? ((await q!`
                select id, ref, project_name, client_name, site_name,
                       folder_id, contact_id, project_id, owner_id, status, parent_ref,
                       created_at, updated_at
                from quotations
                where project_id = any(${hasLink ? linkedIds : [projectId]}::int[])
                  and deleted_at is null
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
      // Flag rows that belong to the LINKED counterpart project (not the one
      // being viewed) so the UI can render them read-only — the salesperson
      // views the presales quotation, they don't edit / move / delete it.
      const annotatedRows = projectRows.map((r) => ({
        ...r,
        read_only: Number(r.project_id) !== projectId,
      }));
      return NextResponse.json({ quotations: annotatedRows });
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
    const useD1 = false; // D1 paused — see GET above
    const q = useD1 ? null : sql();
    const existingRows = (await q!`
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

    // V1.3b — a plain salesperson can't edit quotation content in the
    // Designer; they may only request changes back to presales. Lightweight
    // metadata moves (folder_id / project_id / contact_id only — used by
    // MoveToFolder and drag-drop) stay allowed because they don't carry any
    // of the content fields below.
    const editsContent =
      body.items !== undefined ||
      body.totals !== undefined ||
      body.config !== undefined ||
      body.project_name !== undefined ||
      body.tax_percent !== undefined ||
      body.site_name !== undefined ||
      body.sales_engineer !== undefined ||
      body.prepared_by !== undefined ||
      body.client_name !== undefined ||
      body.client_email !== undefined ||
      body.client_phone !== undefined;
    if (editsContent && (await isSalesEditLocked(user))) {
      return NextResponse.json(
        {
          error:
            "Salespeople can't edit quotations in the Designer. Use “Request changes” to send updates back to presales.",
        },
        { status: 403 },
      );
    }

    // Verify project ownership when the caller is reassigning the quotation
    // to a different project. Mirrors the folder-ownership guard below so a
    // user can never plant a quotation under another user's project.
    if (
      user.role !== "admin" &&
      body.project_id !== undefined &&
      body.project_id !== null
    ) {
      const projectRows = (await q!`
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
      const folderRows = (await q!`
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
      const contactRows = (await q!`
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
    // Never persist the "####" preview placeholder. Use an explicit real ref
    // if the client sent one; otherwise keep the existing ref — and if THAT is
    // still a placeholder (a row saved before this guard existed), heal an
    // active quotation by minting its real counter now, attributed to the
    // owner so the initials stay correct.
    let ref: unknown;
    if (body.ref !== undefined && !String(body.ref).includes("#")) {
      ref = body.ref;
    } else if (existing.ref && !String(existing.ref).includes("#")) {
      ref = existing.ref;
    } else if (existing.status === "active" || !existing.status) {
      const ownerRows = (await q!`
        select coalesce(department_code,'') as department_code, username
        from users where id = ${Number(existing.owner_id)} limit 1
      `) as unknown as Array<{ department_code: string; username: string }>;
      ref = await genActiveRef(
        false,
        q,
        ownerRows[0]?.department_code || "",
        ownerRows[0]?.username || user.username,
      );
    } else {
      ref = existing.ref;
    }
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
    // Offload embedded base64 images to R2 (no-op unless OFFLOAD_QUOTATION_IMAGES=1).
    if (hasItems) body.items = await offloadImages(body.items);
    if (hasConfig) body.config = await offloadImages(body.config);
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
          ref as string,
          pn as string,
          cn as string | null,
          ce as string | null,
          cp as string | null,
          se as string | null,
          pb as string | null,
          sn as string,
          tp,
          itemsText,
          totalsText,
          configText,
          fid as number | null,
          cid as number | null,
          pid as number | null,
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

    // When the author re-edits the quotation content, any open change
    // requests filed by sales are considered addressed — close the loop so
    // they stop nagging the author's notification bell.
    if (editsContent) {
      await q!`
        update quotation_change_requests
        set status = 'resolved', resolved_by = ${user.id}, resolved_at = now()
        where quotation_id = ${id} and status = 'open'
      `;
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

    // Creating any quotation here — a priced active record, a draft, or a
    // presales review snapshot — is restricted to presales, presales
    // managers, and admins. Sales never author quotations; they raise a
    // Request for Quotation from the project header, which goes through
    // POST /api/leads (one open RFQ per project is enforced there).
    if (!(await canAuthorQuotation(user))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const useD1 = false; // D1 paused — see GET above
    const q = useD1 ? null : sql();

    // ── Resolve parent for draft / review snapshots ─────────────────────────
    let parentRef: string | null = null;
    let parentProjectId: number | null = null;
    if (mode !== "active") {
      if (body.parent_id) {
        const parentRows = (await q!`
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
    // A ref carrying the "####" preview placeholder (or any '#') is the
    // unfilled auto-format the Designer shows before save — never persist it.
    // Treat it as "auto" so genActiveRef mints the real counter.
    if (
      mode === "active" &&
      body.ref &&
      body.ref.trim() &&
      !body.ref.includes("#")
    ) {
      ref = body.ref.trim();
    } else if (mode === "active") {
      // The reference's leading segment is the author's admin-assigned
      // department code (e.g. "ITD1"); empty falls back to "GEN".
      let dept = "";
      if (useD1) {
        const r = await d1Query<{ department_code: string }>(
          `select coalesce(department_code,'') as department_code from users where id = ?`,
          [user.id],
        );
        dept = r.results[0]?.department_code || "";
      } else {
        const r = (await q!`
          select coalesce(department_code,'') as department_code
          from users where id = ${user.id} limit 1
        `) as Array<{ department_code: string }>;
        dept = r[0]?.department_code || "";
      }
      ref = await genActiveRef(useD1, q, dept, user.username);
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
      const contactRows = (await q!`
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
      const folderRows = (await q!`
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
      const projectRows = (await q!`
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
    // Offload embedded base64 images to R2 (no-op unless OFFLOAD_QUOTATION_IMAGES=1).
    body.items = await offloadImages(body.items ?? []);
    body.config = await offloadImages(body.config ?? {});
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
    const useD1 = false; // D1 paused — see GET above
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
