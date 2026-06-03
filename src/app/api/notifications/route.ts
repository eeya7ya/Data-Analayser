import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSessionUser, canReadAll } from "@/lib/auth";
import { hasModule, hasModuleRole } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Consolidated feed for the TopBar bell + the dashboard Messages/Alarms
 * panel. Two kinds of items share one shape:
 *
 *   • "alarm"   — derived signals (pending approvals, unattached /
 *                 unclassified folders, stock checks).
 *   • "message" — admin announcements (news_posts), audience-filtered.
 *
 * Per-user state lives in `notification_state`: items the user removed
 * are filtered out; items marked read come back with `read: true` so the
 * UI can dim them. `id` doubles as the stable `notif_key` used by the
 * POST handler below.
 */

export type NotificationSeverity = "info" | "warning" | "critical";
export type NotificationKind = "alarm" | "message";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  created_at?: string;
  read?: boolean;
  action?: { label: string; href: string };
  secondary?: { label: string; href: string };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ items: [] as NotificationItem[] });
  }
  await ensureSchema();

  const isAdmin = canReadAll(user);
  const isSales =
    isAdmin || (await hasModuleRole(user.id, "crm", "sales_manager"));
  const isPresales =
    isAdmin || (await hasModuleRole(user.id, "crm", "presales_manager"));
  // Any presales role (member or manager) — drives the shared lead queue.
  const isAnyPresales =
    isPresales || (await hasModuleRole(user.id, "crm", "presales"));

  const q = sql();
  const raw: NotificationItem[] = [];

  // 1.4A — sales-only approval. Only sales managers get the approval alarm;
  // presales never sign off on quotations.
  if (isSales) {
    const approvalRows = (await q`
      select count(*)::int as n from quotations
      where deleted_at is null
        and approved_at is null
        and rejected_at is null
    `) as Array<{ n: number }>;
    const pending = approvalRows[0]?.n ?? 0;
    if (pending > 0) {
      raw.push({
        id: "approvals.pending",
        kind: "alarm",
        severity: "critical",
        title: `${pending} quotation${pending === 1 ? "" : "s"} need your approval`,
        body: "Open the inbox to review and sign off.",
        action: { label: "Open inbox", href: "/inbox/approvals" },
      });
    }
  }

  // Unclaimed leads in the shared presales queue. sendLeadMessage already
  // drops a row in the `notifications` table on create, but the bell feed is
  // built from derived signals (it doesn't read that table), so without this
  // presales never saw waiting leads in the bell. Counting status='new'
  // self-clears the moment someone claims a lead.
  if (isAnyPresales) {
    const newLeadRows = (await q`
      select count(*)::int as n from leads
      where deleted_at is null and status = 'new'
    `) as Array<{ n: number }>;
    const newLeads = newLeadRows[0]?.n ?? 0;
    if (newLeads > 0) {
      raw.push({
        id: "leads.unclaimed",
        kind: "alarm",
        severity: "critical",
        title: `${newLeads} lead${newLeads === 1 ? "" : "s"} waiting in the queue`,
        body: "Sales opened these — claim one to start working it.",
        action: { label: "Open queue", href: "/leads" },
      });
    }
  }

  const ownerFilter = isAdmin ? null : user.id;

  const unattachedRows = (await q`
    select count(*)::int as n from client_folders
    where deleted_at is null
      and kind = 'company'
      and company_id is null
      and (${ownerFilter}::int is null or owner_id = ${ownerFilter})
  `) as Array<{ n: number }>;
  const unattached = unattachedRows[0]?.n ?? 0;
  if (unattached > 0) {
    raw.push({
      id: "folders.unattached_company",
      kind: "alarm",
      severity: "warning",
      title: `${unattached} client folder${unattached === 1 ? "" : "s"} marked company but not attached to one`,
      body: "They keep working, they just don't show up under any company yet. Attach them by opening the folder and picking a company.",
      action: { label: "Open unattached", href: "/crm/unclassified" },
      secondary: isAdmin
        ? { label: "Admin → Folders quarantine", href: "/admin" }
        : undefined,
    });
  }

  if (isAdmin) {
    const unclassifiedRows = (await q`
      select count(*)::int as n from client_folders
      where deleted_at is null and kind is null
    `) as Array<{ n: number }>;
    const unclassified = unclassifiedRows[0]?.n ?? 0;
    if (unclassified > 0) {
      raw.push({
        id: "folders.unclassified",
        kind: "alarm",
        severity: "warning",
        title: `${unclassified} folder${unclassified === 1 ? "" : "s"} need classification`,
        body: "Pre-V2 folders that haven't been marked Company / Individual yet. Pick a path to clear them.",
        action: { label: "View unclassified", href: "/crm/unclassified" },
        secondary: { label: "Admin → Folders", href: "/admin" },
      });
    }
  }

  const isStorage = isAdmin || (await hasModule(user.id, "storage"));
  if (isStorage) {
    const pendingChecks = (await q`
      select count(*)::int as n from quotation_stock_checks c
      join quotations qq on qq.id = c.quotation_id
      where c.status = 'pending' and qq.deleted_at is null
    `) as Array<{ n: number }>;
    const n = pendingChecks[0]?.n ?? 0;
    if (n > 0) {
      raw.push({
        id: "stock_checks.pending",
        kind: "alarm",
        severity: "warning",
        title: `${n} BOQ stock check${n === 1 ? "" : "s"} waiting`,
        body: "Open the storage inbox to mark each item available / partial / out.",
        action: { label: "Open inbox", href: "/storage" },
      });
    }
  }

  const recentAnswered = (await q`
    select count(*)::int as n from quotation_stock_checks c
    join quotations qq on qq.id = c.quotation_id
    where c.status = 'answered'
      and qq.deleted_at is null
      and c.requested_by = ${user.id}
      and c.answered_at > now() - interval '72 hours'
  `) as Array<{ n: number }>;
  const recent = recentAnswered[0]?.n ?? 0;
  if (recent > 0) {
    raw.push({
      id: "stock_checks.answered",
      kind: "alarm",
      severity: "info",
      title: `Storage answered ${recent} stock check${recent === 1 ? "" : "s"}`,
      body: "Open the quotation to see the per-item checklist.",
      action: { label: "Open CRM", href: "/crm" },
    });
  }

  // Change requests filed by sales against quotations I authored — V1.3b.
  const changeReqRows = (await q`
    select count(*)::int as n from quotation_change_requests
    where target_user_id = ${user.id} and status = 'open'
  `) as Array<{ n: number }>;
  const openChangeReqs = changeReqRows[0]?.n ?? 0;
  if (openChangeReqs > 0) {
    raw.push({
      id: "change_requests.open",
      kind: "alarm",
      severity: "warning",
      title: `${openChangeReqs} change request${openChangeReqs === 1 ? "" : "s"} on your quotations`,
      body: "Sales asked for updates. Open the quotation, edit it, and save to resend.",
      action: { label: "Open CRM", href: "/crm" },
    });
  }

  // V1.3D — quotations the user marked Held for Execution that haven't
  // moved to projects yet. Scheduled holds auto-transfer on the next
  // sweep; manual holds sit here until pushed. Self-clears on transfer.
  const heldRows = (await q`
    select count(*)::int as n from quotations
    where deleted_at is null
      and sales_outcome = 'held'
      and transferred_at is null
      and (${ownerFilter}::int is null or owner_id = ${ownerFilter})
  `) as Array<{ n: number }>;
  const heldPending = heldRows[0]?.n ?? 0;
  if (heldPending > 0) {
    raw.push({
      id: "holds.pending_transfer",
      kind: "alarm",
      severity: "info",
      title: `${heldPending} quotation${heldPending === 1 ? "" : "s"} held for execution`,
      body: "Scheduled holds transfer automatically; transfer the rest when you're ready.",
      action: { label: "Open pipeline", href: "/crm/sales-pipeline" },
    });
  }

  // Project handoffs awaiting a member — projects managers + admins.
  const isProjectsManager =
    isAdmin || (await hasModuleRole(user.id, "projects", "manager"));
  if (isProjectsManager) {
    const pendingHandoffs = (await q`
      select count(*)::int as n from project_handoffs
      where status = 'pending_assignment'
    `) as Array<{ n: number }>;
    const n = pendingHandoffs[0]?.n ?? 0;
    if (n > 0) {
      raw.push({
        id: "handoffs.pending",
        kind: "alarm",
        severity: "warning",
        title: `${n} project${n === 1 ? "" : "s"} awaiting a member`,
        body: "Sales converted these approved quotations — assign a project member to start execution.",
        action: { label: "Assign", href: "/projects/handoffs" },
      });
    }
  }

  // A handoff assigned to me — the project member's heads-up.
  const myAssigned = (await q`
    select count(*)::int as n from project_handoffs
    where status = 'assigned' and assigned_user_id = ${user.id}
  `) as Array<{ n: number }>;
  const mine = myAssigned[0]?.n ?? 0;
  if (mine > 0) {
    raw.push({
      id: "handoffs.assigned_to_me",
      kind: "alarm",
      severity: "info",
      title: `${mine} project${mine === 1 ? "" : "s"} assigned to you`,
      body: "Open the handoff to view the BOQ, contacts, and site location.",
      action: { label: "View", href: "/projects/handoffs" },
    });
  }

  // Lead inbox — unread lead messages addressed to this user. The assign
  // route's sendLeadMessage() writes a row here whenever a lead is
  // distributed / re-routed to someone, but this bell feed is otherwise
  // built only from derived signals, so the recipient (e.g. the presales
  // engineer a lead was just handed to) never actually saw "a lead was
  // distributed to you". Surfacing the unread ones fixes that; opening
  // the lead inbox marks them read, which self-clears the alarm.
  const leadMsgRows = (await q`
    select m.id, m.subject, m.body, m.lead_id, m.created_at
    from lead_messages m
    where m.recipient_id = ${user.id}
      and m.read_at is null
    order by m.created_at desc
    limit 20
  `) as Array<{
    id: number;
    subject: string;
    body: string;
    lead_id: number | null;
    created_at: string;
  }>;
  for (const m of leadMsgRows) {
    raw.push({
      id: `lead_msg:${m.id}`,
      kind: "message",
      severity: "info",
      title: m.subject,
      body: m.body,
      created_at: m.created_at,
      action: m.lead_id
        ? { label: "Open lead", href: `/leads/${m.lead_id}` }
        : undefined,
    });
  }

  // Messages — admin announcements, audience-filtered the same way the
  // NewsBar does (the 'all' tag is a wildcard in either array).
  const grants = (await q`
    select module, role from user_module_roles
    where user_id = ${user.id} and revoked_at is null
  `) as Array<{ module: string; role: string }>;
  const moduleTags = ["all", ...grants.map((g) => g.module)];
  const roleTags = ["all", ...grants.map((g) => g.role)];
  const newsRows = (await q`
    select n.id, n.title, n.body, n.pinned, n.created_at
    from news_posts n
    where n.deleted_at is null
      and (n.expires_at is null or n.expires_at > now())
      and (
        ${isAdmin}::boolean
        or (n.audience_modules && ${moduleTags}::text[]
            and n.audience_roles && ${roleTags}::text[])
      )
    order by n.pinned desc, n.created_at desc
    limit 30
  `) as Array<{
    id: number;
    title: string;
    body: string;
    pinned: boolean;
    created_at: string;
  }>;
  for (const m of newsRows) {
    raw.push({
      id: `news:${m.id}`,
      kind: "message",
      severity: "info",
      title: m.title,
      body: m.body,
      created_at: m.created_at,
    });
  }

  // Apply per-user state: drop removed, flag read.
  const stateRows = (await q`
    select notif_key, status from notification_state
    where user_id = ${user.id}
  `) as Array<{ notif_key: string; status: "read" | "removed" }>;
  const state = new Map(stateRows.map((r) => [r.notif_key, r.status]));
  const items = raw
    .filter((it) => state.get(it.id) !== "removed")
    .map((it) => ({ ...it, read: state.get(it.id) === "read" }));

  return NextResponse.json({ items });
}

/**
 * Record per-user state for one feed item. `status: "read"` dims it;
 * `status: "removed"` hides it from the feed. Re-deriving the same key
 * later (e.g. a fresh batch of approvals) re-uses the stored status, so
 * removing a recurring alarm hides only the current instance until its
 * count changes — which is the expected "dismiss this for now" UX.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  await ensureSchema();

  const body = (await req.json().catch(() => ({}))) as {
    key?: string;
    status?: string;
    all?: boolean;
  };
  const status = body.status === "read" || body.status === "removed" ? body.status : null;
  if (!status) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const q = sql();

  // "Mark all read": stamp every currently-derived alarm/message key.
  // The client passes the visible keys so we don't have to re-derive the
  // whole feed server-side.
  if (body.all && Array.isArray((body as { keys?: string[] }).keys)) {
    const keys = ((body as { keys?: string[] }).keys ?? [])
      .map(String)
      .filter(Boolean)
      .slice(0, 200);
    for (const key of keys) {
      await q`
        insert into notification_state (user_id, notif_key, status)
        values (${user.id}, ${key}, ${status})
        on conflict (user_id, notif_key)
        do update set status = ${status}, updated_at = now()
      `;
    }
    return NextResponse.json({ ok: true, count: keys.length });
  }

  const key = String(body.key ?? "").trim();
  if (!key) {
    return NextResponse.json({ error: "key required" }, { status: 400 });
  }
  await q`
    insert into notification_state (user_id, notif_key, status)
    values (${user.id}, ${key}, ${status})
    on conflict (user_id, notif_key)
    do update set status = ${status}, updated_at = now()
  `;
  return NextResponse.json({ ok: true });
}
