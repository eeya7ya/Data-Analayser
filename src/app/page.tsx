import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import { hasModuleRole, getUserModuleRoles } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import DashboardClient, { type DashboardData } from "@/components/DashboardClient";
import ExecutionDashboardClient, {
  type ExecutionProject,
} from "@/components/ExecutionDashboardClient";
import StorageDashboardClient, {
  type StorageCheckRow,
} from "@/components/StorageDashboardClient";

export const dynamic = "force-dynamic";

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

  if (!isAdmin && isProjects && !isCrm) {
    const me = user.id;
    const qx = sql();
    const kpiRows = (await qx`
      select
        (select count(distinct pa.project_id) from project_assignments pa
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

    const projectRows = (await qx`
      select distinct on (p.id)
             p.id, p.name, p.status, pa.role, pa.notes,
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
      order by p.id, p.updated_at desc
      limit 50
    `) as ExecutionProject[];

    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
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

  // Non-admins see only their own rows; admins see everything.
  const scope = isAdmin ? null : user.id;
  const q = sql();

  const kpiRows = (await q`
    select
      (select count(*) from quotations
        where deleted_at is null
          and (${scope}::int is null or owner_id = ${scope}))::int as quotations,
      (select count(*) from client_folders
        where deleted_at is null
          and (${scope}::int is null or owner_id = ${scope}))::int as clients,
      (select count(*) from companies
        where deleted_at is null
          and (${scope}::int is null or owner_id = ${scope}))::int as companies,
      (select count(*) from projects
        where deleted_at is null
          and (${scope}::int is null or owner_id = ${scope}))::int as projects
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

  // Three granularities for the trend chart, all computed in one pass so
  // the client can flip between them without a round-trip (V1.3D toggle).
  const monthlyRows = (await q`
    select to_char(m, 'Mon') as label, coalesce(c.n, 0)::int as count
    from generate_series(
      date_trunc('month', now()) - interval '5 months',
      date_trunc('month', now()),
      interval '1 month'
    ) as m
    left join (
      select date_trunc('month', created_at) as mm, count(*)::int as n
      from quotations
      where deleted_at is null
        and created_at > now() - interval '6 months'
        and (${scope}::int is null or owner_id = ${scope})
      group by mm
    ) c on c.mm = m
    order by m
  `) as Array<{ label: string; count: number }>;

  const weeklyRows = (await q`
    select to_char(m, 'DD Mon') as label, coalesce(c.n, 0)::int as count
    from generate_series(
      date_trunc('week', now()) - interval '11 weeks',
      date_trunc('week', now()),
      interval '1 week'
    ) as m
    left join (
      select date_trunc('week', created_at) as ww, count(*)::int as n
      from quotations
      where deleted_at is null
        and created_at > now() - interval '12 weeks'
        and (${scope}::int is null or owner_id = ${scope})
      group by ww
    ) c on c.ww = m
    order by m
  `) as Array<{ label: string; count: number }>;

  const dailyRows = (await q`
    select to_char(m, 'DD Mon') as label, coalesce(c.n, 0)::int as count
    from generate_series(
      date_trunc('day', now()) - interval '29 days',
      date_trunc('day', now()),
      interval '1 day'
    ) as m
    left join (
      select date_trunc('day', created_at) as dd, count(*)::int as n
      from quotations
      where deleted_at is null
        and created_at > now() - interval '30 days'
        and (${scope}::int is null or owner_id = ${scope})
      group by dd
    ) c on c.dd = m
    order by m
  `) as Array<{ label: string; count: number }>;

  // Sales outcome breakdown — Won / Lost / Held for the outcome panel.
  const outcomeRows = (await q`
    select
      count(*) filter (
        where sales_outcome = 'accepted' or transferred_at is not null
      )::int as won,
      count(*) filter (where sales_outcome = 'rejected')::int as lost,
      count(*) filter (
        where sales_outcome = 'held' and transferred_at is null
      )::int as held
    from quotations
    where deleted_at is null
      and (${scope}::int is null or owner_id = ${scope})
  `) as Array<{ won: number; lost: number; held: number }>;

  const statusRows = (await q`
    select coalesce(nullif(status, ''), 'active') as name, count(*)::int as value
    from quotations
    where deleted_at is null
      and (${scope}::int is null or owner_id = ${scope})
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
      and (${scope}::int is null or owner_id = ${scope})
  `) as Array<{ approved: number; rejected: number; pending: number }>;

  const data: DashboardData = {
    kpis: {
      quotations: kpi.quotations,
      clients: kpi.clients,
      companies: kpi.companies,
      projects: kpi.projects,
      pendingApprovals,
    },
    monthly: monthlyRows.map((r) => ({ label: r.label, count: Number(r.count) })),
    weekly: weeklyRows.map((r) => ({ label: r.label, count: Number(r.count) })),
    daily: dailyRows.map((r) => ({ label: r.label, count: Number(r.count) })),
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
      <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
        <DashboardClient
          data={data}
          greetingName={user.display_name || user.username}
          showApprovals={isSalesManager}
          showOutcomes={isSales}
        />
      </main>
    </div>
  );
}
