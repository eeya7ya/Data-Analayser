import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import { hasModuleRole } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import DashboardClient, { type DashboardData } from "@/components/DashboardClient";

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
