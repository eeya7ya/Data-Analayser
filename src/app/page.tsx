import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { getTenantUserIds } from "@/lib/scope";
import { sql, ensureSchema } from "@/lib/db";
import { hasModuleRole, getUserModuleRoles } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import RouteRefresher from "@/components/RouteRefresher";
import DashboardClient, { type DashboardData } from "@/components/DashboardClient";
import AdminDashboardClient, {
  type AdminDashboardData,
} from "@/components/AdminDashboardClient";
import ExecutionDashboardClient, {
  type ExecutionProject,
} from "@/components/ExecutionDashboardClient";
import StorageDashboardClient, {
  type StorageCheckRow,
} from "@/components/StorageDashboardClient";

export const dynamic = "force-dynamic";

/**
 * Bucket a list of timestamps into the last `periods` calendar periods of the
 * given granularity, ending with the current period (oldest → newest). Used for
 * the dashboard trend chart so it runs on D1/SQLite (no generate_series /
 * date_trunc / to_char) as well as Postgres. Labels match the old SQL: bare
 * month name for "month", "DD Mon" for week/day.
 */
function bucketTrend(
  rows: Array<{ d: string | Date | null }>,
  granularity: "month" | "week" | "day",
  periods: number,
): Array<{ label: string; count: number }> {
  const startOf = (input: Date): Date => {
    const d = new Date(input);
    d.setHours(0, 0, 0, 0);
    if (granularity === "day") return d;
    if (granularity === "week") {
      const dow = (d.getDay() + 6) % 7; // 0 = Monday
      d.setDate(d.getDate() - dow);
      return d;
    }
    d.setDate(1);
    return d;
  };
  const stepBack = (input: Date, n: number): Date => {
    const d = new Date(input);
    if (granularity === "day") d.setDate(d.getDate() - n);
    else if (granularity === "week") d.setDate(d.getDate() - n * 7);
    else d.setMonth(d.getMonth() - n);
    return d;
  };
  const label = (d: Date): string =>
    granularity === "month"
      ? d.toLocaleString("en-US", { month: "short" })
      : `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-US", {
          month: "short",
        })}`;

  const base = startOf(new Date());
  const buckets = Array.from({ length: periods }, (_, i) => {
    const start = stepBack(base, periods - 1 - i);
    return { key: start.getTime(), label: label(start), count: 0 };
  });
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const r of rows) {
    if (!r.d) continue;
    const dt = new Date(r.d as string);
    if (Number.isNaN(dt.getTime())) continue;
    const b = byKey.get(startOf(dt).getTime());
    if (b) b.count++;
  }
  return buckets.map((b) => ({ label: b.label, count: b.count }));
}

/**
 * V1.3a dashboard. Modules moved into the CRM hub + the LHS drawer, so
 * this page is now a personal analytics board plus the Messages/Alarms
 * inbox. All aggregates are computed in one server pass and handed to
 * the client chart component, so the page paints once (no empty→data
 * re-render — `loading.tsx` covers the navigation gap).
 */
export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  await ensureSchema();

  const isAdmin = canReadAll(user);
  // 1.4A — approvals are sales-only. Only a sales manager (or admin) signs
  // off and sees the "Awaiting approval" action card; presales never do.
  const isSalesManager =
    isAdmin || (await hasModuleRole(user.id, "crm", "sales_manager"));

  // Role-aware dashboard. A "pure" projects person (technician /
  // engineer / project manager with no sales/presales hat and not an
  // admin) cares about execution, not quotation analytics — they get a
  // dedicated board built from their project assignments.
  const grants = await getUserModuleRoles(user.id);
  const hasGrant = (m: string, r?: string) =>
    grants.some((g) => g.module === m && (r ? g.role === r : true));
  const isCrm = hasGrant("crm");
  const isProjects = hasGrant("projects");
  const isProjectsManager = isAdmin || hasGrant("projects", "manager");
  // "Sales outcomes" (Won / Lost / Held) is a salesperson's scoreboard —
  // only sales roles (and admins) should see it on the dashboard.
  const isSales = isSalesManager || hasGrant("crm", "sales");
  // A salesperson SELLS — they don't author quotations (presales do), so a
  // "Quotations created" chart is meaningless for them. When the user's lens is
  // sales-only (no presales hat), the dashboard reframes around the deals THEY
  // close: the headline trend, primary KPI and outcome scoreboard scope to the
  // deals they decided (sales_outcome_by), not the quotations they own.
  const isPresales =
    hasGrant("crm", "presales") || hasGrant("crm", "presales_manager");
  const salesLens = isSales && !isPresales;

  if (!isAdmin && isProjects && !isCrm) {
    const me = user.id;
    const qx = sql();
    const kpiRows = (await qx`
      select
        (select count(distinct p.id) from project_assignments pa
           join projects p on p.id = pa.project_id and p.deleted_at is null
           where pa.user_id = ${me} and pa.deleted_at is null)::int as my_projects,
        (select count(distinct p.id) from project_assignments pa
           join projects p on p.id = pa.project_id and p.deleted_at is null
           where pa.user_id = ${me} and pa.deleted_at is null
             and p.status <> 'completed')::int as in_execution,
        (select count(distinct p.id) from project_assignments pa
           join projects p on p.id = pa.project_id and p.deleted_at is null
           where pa.user_id = ${me} and pa.deleted_at is null
             and p.status = 'completed')::int as completed,
        (select count(*) from execution_reports where author_id = ${me})::int as my_reports
    `) as Array<{
      my_projects: number;
      in_execution: number;
      completed: number;
      my_reports: number;
    }>;

    let awaitingAssignment = 0;
    if (isProjectsManager) {
      const r = (await qx`
        select count(*)::int as n from project_handoffs
        where status = 'pending_assignment'
      `) as Array<{ n: number }>;
      awaitingAssignment = Number(r[0].n);
    }

    const projectRowsRaw = (await qx`
      select p.id, p.name, p.status, pa.role, pa.notes,
             cf.name as client_name, p.updated_at,
             case
               when exists (
                 select 1 from execution_reports r
                 where r.project_id = p.id and r.kind = 'done'
               ) then 100
               when exists (
                 select 1 from execution_reports r
                 where r.project_id = p.id and r.progress is not null
               ) then (
                 select r.progress from execution_reports r
                 where r.project_id = p.id and r.progress is not null
                 order by r.created_at desc
                 limit 1
               )
               when exists (
                 select 1 from project_tasks t
                 where t.project_id = p.id and t.deleted_at is null
               ) then (
                 select round(
                   100.0 * count(*) filter (where t.done) / nullif(count(*), 0)
                 )::int
                 from project_tasks t
                 where t.project_id = p.id and t.deleted_at is null
               )
               else 0
             end::int as completion
      from project_assignments pa
      join projects p on p.id = pa.project_id and p.deleted_at is null
      join client_folders cf on cf.id = p.folder_id
      where pa.user_id = ${me} and pa.deleted_at is null
      order by p.updated_at desc
    `) as ExecutionProject[];
    // De-dupe to one row per project (latest first) in JS — replaces Postgres'
    // `distinct on (p.id)`, which SQLite/D1 doesn't support. Cap at 50.
    const seenProjectIds = new Set<number>();
    const projectRows = projectRowsRaw
      .filter((p) => {
        if (seenProjectIds.has(p.id)) return false;
        seenProjectIds.add(p.id);
        return true;
      })
      .slice(0, 50);

    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <RouteRefresher />
        <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
          <ExecutionDashboardClient
            greetingName={user.display_name || user.username}
            isManager={isProjectsManager}
            kpis={{
              myProjects: kpiRows[0].my_projects,
              inExecution: kpiRows[0].in_execution,
              completed: kpiRows[0].completed,
              myReports: kpiRows[0].my_reports,
              awaitingAssignment,
            }}
            projects={projectRows}
          />
        </main>
      </div>
    );
  }

  // Storage people get a stock-checks board. (V1.5A removed the legacy flat
  // inventory; the new event-sourced stock module is spec'd in
  // docs/storage-module-v1.5A.md.)
  const isStorage = hasGrant("storage");
  if (!isAdmin && isStorage && !isCrm && !isProjects) {
    const qs = sql();
    const k = (await qs`
      select
        (select count(*) from quotation_stock_checks where status = 'pending')::int  as pending_checks,
        (select count(*) from quotation_stock_checks where status = 'answered')::int as answered_checks
    `) as Array<{ pending_checks: number; answered_checks: number }>;
    const checks = (await qs`
      select c.id, c.quotation_id, q.ref as quotation_ref, q.project_name,
             jsonb_array_length(c.items_json) as item_count, c.created_at
      from quotation_stock_checks c
      join quotations q on q.id = c.quotation_id
      where c.status = 'pending'
      order by c.created_at desc
      limit 20
    `) as StorageCheckRow[];

    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <RouteRefresher />
        <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
          <StorageDashboardClient
            greetingName={user.display_name || user.username}
            kpis={{
              pendingChecks: k[0].pending_checks,
              answeredChecks: k[0].answered_checks,
            }}
            checks={checks}
          />
        </main>
      </div>
    );
  }

  // Admins get an administration board: people, roles and departments —
  // not the salesperson's quotation analytics. (They can still open the CRM
  // module for the sales view.)
  if (isAdmin) {
    const qa = sql();
    const adminKpiRows = (await qa`
      select
        (select count(*) from users)::int as users,
        (select count(*) from users where role = 'admin')::int as admins,
        (select count(distinct user_id) from user_module_roles
          where revoked_at is null)::int as with_role,
        (select count(distinct department_code) from users
          where coalesce(department_code, '') <> '')::int as departments
    `) as Array<{
      users: number;
      admins: number;
      with_role: number;
      departments: number;
    }>;

    const deptRows = (await qa`
      select
        coalesce(nullif(u.department_code, ''), 'Unassigned') as code,
        count(distinct u.id)::int as users,
        count(q.id)::int as quotations
      from users u
      left join quotations q
        on q.owner_id = u.id and q.deleted_at is null
      group by 1
      order by users desc, code asc
    `) as Array<{ code: string; users: number; quotations: number }>;

    const adminData: AdminDashboardData = {
      kpis: {
        users: Number(adminKpiRows[0].users),
        admins: Number(adminKpiRows[0].admins),
        withRole: Number(adminKpiRows[0].with_role),
        departments: Number(adminKpiRows[0].departments),
      },
      departments: deptRows.map((r) => ({
        code: r.code,
        users: Number(r.users),
        quotations: Number(r.quotations),
      })),
    };

    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <RouteRefresher />
        <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
          <AdminDashboardClient
            data={adminData}
            greetingName={user.display_name || user.username}
          />
        </main>
      </div>
    );
  }

  // Non-admins see only their own rows; admins see everything.
  const scope = isAdmin ? await getTenantUserIds(user.id) : [user.id];
  const q = sql();

  const kpiRows = (await q`
    select
      (select count(*) from quotations
        where deleted_at is null
          and owner_id = any(${scope}::int[]))::int as quotations,
      (select count(*) from client_folders
        where deleted_at is null
          and owner_id = any(${scope}::int[]))::int as clients,
      (select count(*) from companies
        where deleted_at is null
          and owner_id = any(${scope}::int[]))::int as companies,
      (select count(*) from projects
        where deleted_at is null
          and owner_id = any(${scope}::int[]))::int as projects
  `) as Array<{ quotations: number; clients: number; companies: number; projects: number }>;
  const kpi = kpiRows[0];

  let pendingApprovals = 0;
  if (isSalesManager) {
    // Quotations awaiting the sales manager's sign-off (sales-only model).
    const rows = (await q`
      select count(*)::int as n from quotations
      where deleted_at is null
        and approved_at is null
        and rejected_at is null
    `) as Array<{ n: number }>;
    pendingApprovals = Number(rows[0].n);
  }

  // ── Trend chart (monthly / weekly / daily) ───────────────────────────────
  // Computed in JS so it works on D1/SQLite (which has no generate_series /
  // date_trunc / to_char and can't compose tagged-template fragments) as well
  // as Postgres. We pull the relevant dates once over the widest window (the
  // last 6 months) and bucket them three ways for the client's toggle. The
  // trend counts quotations CREATED (default — presales/mixed) or deals WON
  // (sales lens); the date column + filter swap accordingly.
  const trendStart = new Date();
  trendStart.setMonth(trendStart.getMonth() - 6);
  trendStart.setDate(1);
  const trendCutoff = trendStart.toISOString().slice(0, 10); // YYYY-MM-DD

  const trendDates = (
    salesLens
      ? await q`
          select coalesce(sales_outcome_at, updated_at) as d
          from quotations
          where deleted_at is null
            and sales_outcome_by = ${user.id}
            and (sales_outcome = 'accepted' or transferred_at is not null)
            and coalesce(sales_outcome_at, updated_at) >= ${trendCutoff}
        `
      : await q`
          select created_at as d
          from quotations
          where deleted_at is null
            and owner_id = any(${scope}::int[])
            and created_at >= ${trendCutoff}
        `
  ) as Array<{ d: string | null }>;

  const monthly = bucketTrend(trendDates, "month", 6);
  const weekly = bucketTrend(trendDates, "week", 12);
  const daily = bucketTrend(trendDates, "day", 30);

  // Sales outcome breakdown — Won / Lost / Held for the outcome panel. In the
  // sales lens this counts the deals THIS user decided, not quotations they own.
  const outcomeRows = (
    salesLens
      ? await q`
          select
            count(*) filter (where sales_outcome = 'accepted' or transferred_at is not null) as won,
            count(*) filter (where sales_outcome = 'rejected') as lost,
            count(*) filter (where sales_outcome = 'held' and transferred_at is null) as held
          from quotations
          where deleted_at is null and sales_outcome_by = ${user.id}
        `
      : await q`
          select
            count(*) filter (where sales_outcome = 'accepted' or transferred_at is not null) as won,
            count(*) filter (where sales_outcome = 'rejected') as lost,
            count(*) filter (where sales_outcome = 'held' and transferred_at is null) as held
          from quotations
          where deleted_at is null and owner_id = any(${scope}::int[])
        `
  ) as Array<{ won: number; lost: number; held: number }>;

  const statusRows = (await q`
    select coalesce(nullif(status, ''), 'active') as name, count(*)::int as value
    from quotations
    where deleted_at is null
      and owner_id = any(${scope}::int[])
    group by 1
    order by value desc
  `) as Array<{ name: string; value: number }>;

  const approvalRows = (await q`
    select
      count(*) filter (where approved_at is not null)::int as approved,
      count(*) filter (where rejected_at is not null)::int as rejected,
      count(*) filter (where approved_at is null and rejected_at is null)::int as pending
    from quotations
    where deleted_at is null
      and owner_id = any(${scope}::int[])
  `) as Array<{ approved: number; rejected: number; pending: number }>;

  const data: DashboardData = {
    kpis: {
      // In the sales lens the lead KPI is "Deals won" (their closed deals),
      // since a salesperson owns ~no quotations.
      quotations: salesLens ? Number(outcomeRows[0].won) : kpi.quotations,
      clients: kpi.clients,
      companies: kpi.companies,
      projects: kpi.projects,
      pendingApprovals,
    },
    monthly,
    weekly,
    daily,
    outcomes: {
      won: Number(outcomeRows[0].won),
      lost: Number(outcomeRows[0].lost),
      held: Number(outcomeRows[0].held),
    },
    status: statusRows.map((r) => ({
      name: r.name.charAt(0).toUpperCase() + r.name.slice(1),
      value: Number(r.value),
    })),
    approvals: {
      approved: Number(approvalRows[0].approved),
      pending: Number(approvalRows[0].pending),
      rejected: Number(approvalRows[0].rejected),
    },
  };

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      {/* Keep the KPI counts in step with the database: without this, Next's
          client-side Router Cache can serve a stale RSC payload when the user
          navigates back after deleting a quotation/client/company/project, so
          the "removed everything" numbers appeared to linger. Mirrors the
          admin / execution / storage dashboards above. */}
      <RouteRefresher />
      <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
        <DashboardClient
          data={data}
          greetingName={user.display_name || user.username}
          showApprovals={isSalesManager}
          showOutcomes={isSales}
          primaryKpiLabel={salesLens ? "Deals won" : "Quotations"}
          chartTitle={salesLens ? "Deals won" : "Quotations created"}
          chartNoun={salesLens ? "Deals won" : "Quotations"}
        />
      </main>
    </div>
  );
}
