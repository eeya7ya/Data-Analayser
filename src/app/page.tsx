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
  type StorageRequestRow,
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
  const isSalesManager =
    isAdmin || (await hasModuleRole(user.id, "crm", "sales_manager"));
  const isPresalesManager =
    isAdmin || (await hasModuleRole(user.id, "crm", "presales_manager"));
  const isManager = isSalesManager || isPresalesManager;

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
             cf.name as client_name, p.updated_at
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

  // Storage people get a warehouse-oriented board.
  const isStorage = hasGrant("storage");
  if (!isAdmin && isStorage && !isCrm && !isProjects) {
    const qs = sql();
    const k = (await qs`
      select
        (select count(*) from storage_requests where status = 'pending')::int as pending,
        (select count(*) from storage_requests where status = 'fulfilled')::int as fulfilled,
        (select count(*) from storage_locations where deleted_at is null)::int as locations,
        (select count(distinct product_id) from storage_stock)::int as stock_items,
        (select count(*) from quotation_stock_checks where status = 'pending')::int as pending_checks
    `) as Array<{
      pending: number;
      fulfilled: number;
      locations: number;
      stock_items: number;
      pending_checks: number;
    }>;
    const reqs = (await qs`
      select sr.id, sr.quantity, sr.status, sr.created_at,
             coalesce(nullif(trim(p.vendor || ' ' || p.model), ''), 'Item') as product_label,
             pr.name as project_name
      from storage_requests sr
      left join products p on p.id = sr.product_id
      left join projects pr on pr.id = sr.project_id
      where sr.status = 'pending'
      order by sr.created_at desc
      limit 20
    `) as StorageRequestRow[];

    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
          <StorageDashboardClient
            greetingName={user.display_name || user.username}
            kpis={{
              pending: k[0].pending,
              fulfilled: k[0].fulfilled,
              locations: k[0].locations,
              stockItems: k[0].stock_items,
              pendingChecks: k[0].pending_checks,
            }}
            requests={reqs}
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
  if (isManager) {
    const rows = (await q`
      select
        (case when ${isSalesManager}
              then (select count(*) from quotations
                    where deleted_at is null
                      and sales_approved_at is null
                      and rejected_at is null
                      and approved_at is null)
              else 0 end) as needs_sales,
        (case when ${isPresalesManager}
              then (select count(*) from quotations
                    where deleted_at is null
                      and presales_approved_at is null
                      and rejected_at is null
                      and approved_at is null)
              else 0 end) as needs_presales
    `) as Array<{ needs_sales: number; needs_presales: number }>;
    pendingApprovals = Number(rows[0].needs_sales) + Number(rows[0].needs_presales);
  }

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
          isManager={isManager}
        />
      </main>
    </div>
  );
}
