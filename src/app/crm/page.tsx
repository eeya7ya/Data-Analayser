import Link from "next/link";
import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import { getUserModuleRoles } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import UserScopePicker from "@/components/UserScopePicker";
import CrmModuleHub, {
  type CrmHubFlags,
  type CrmHubCounts,
} from "@/components/CrmModuleHub";

export const dynamic = "force-dynamic";

interface SearchParams {
  user?: string;
  tool?: string;
}

/**
 * /crm — the module hub. Role-based tabs (Sales / Presales / Storage /
 * Projects / Pricing) sit alongside the core Clients drill-down, so the
 * modules that used to live on the dashboard now surface here, filtered
 * by the signed-in user's grants. Admins / viewers can scope the Clients
 * counts to one user via `?user=<id>`.
 */
export default async function CrmLandingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  await ensureSchema();

  const isAdmin = canReadAll(user);
  const sp = await searchParams;
  const requestedScope = isAdmin && sp.user ? Number(sp.user) : null;
  const scopeOwnerId = isAdmin
    ? Number.isFinite(requestedScope) && requestedScope! > 0
      ? requestedScope
      : null
    : user.id;
  const scopeSuffix = scopeOwnerId ? `?user=${scopeOwnerId}` : "";
  const q = sql();

  // Role flags drive which module tabs render. Admins see everything.
  const grants = await getUserModuleRoles(user.id);
  const hasRole = (module: string, role?: string) =>
    grants.some((g) => g.module === module && (role ? g.role === role : true));
  const flags: CrmHubFlags = {
    sales: isAdmin || hasRole("crm", "sales") || hasRole("crm", "sales_manager"),
    presales:
      isAdmin || hasRole("crm", "presales") || hasRole("crm", "presales_manager"),
    storage: isAdmin || hasRole("storage"),
    projects: isAdmin || hasRole("projects"),
    projectsManager: isAdmin || hasRole("projects", "manager"),
    salesManager: isAdmin || hasRole("crm", "sales_manager"),
    presalesManager: isAdmin || hasRole("crm", "presales_manager"),
    // Pricing tab: admins/viewers, anyone with an explicit pricing grant
    // (delegated by a presales manager), or a presales manager (auto).
    pricing:
      isAdmin || hasRole("pricing") || hasRole("crm", "presales_manager"),
    // Executive tab: the sign-off queue for confirming quotations + pricing.
    executive: isAdmin || hasRole("crm", "executive_manager"),
  };

  type CountRow = {
    company_entities: number;
    company_clients: number;
    individual_folders: number;
    company_quotations: number;
    individual_quotations: number;
  };
  const countsRows = (await q`
    select
      (select count(*) from companies
         where deleted_at is null
           and (${scopeOwnerId}::int is null or owner_id = ${scopeOwnerId})) as company_entities,
      (select count(*) from client_folders
         where deleted_at is null and kind = 'company'
           and (${scopeOwnerId}::int is null or owner_id = ${scopeOwnerId})) as company_clients,
      (select count(*) from client_folders
         where deleted_at is null and kind = 'individual'
           and (${scopeOwnerId}::int is null or owner_id = ${scopeOwnerId})) as individual_folders,
      (select count(*) from quotations qq
         join client_folders cf on cf.id = qq.folder_id
         where qq.deleted_at is null and cf.deleted_at is null and cf.kind = 'company'
           and (${scopeOwnerId}::int is null or cf.owner_id = ${scopeOwnerId})) as company_quotations,
      (select count(*) from quotations qq
         join client_folders cf on cf.id = qq.folder_id
         where qq.deleted_at is null and cf.deleted_at is null and cf.kind = 'individual'
           and (${scopeOwnerId}::int is null or cf.owner_id = ${scopeOwnerId})) as individual_quotations
  `) as CountRow[];
  const c = countsRows[0];
  const counts: CrmHubCounts = {
    companies: Number(c.company_entities),
    companyClients: Number(c.company_clients),
    individuals: Number(c.individual_folders),
    companyQuotations: Number(c.company_quotations),
    individualQuotations: Number(c.individual_quotations),
  };

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <div>
          <Link href="/" className="text-xs text-magic-ink/50 hover:text-magic-red">
            ← Dashboard
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-magic-ink">CRM</h1>
          <p className="mt-0.5 text-sm text-magic-ink/60">
            Your workspace. The tools you see reflect your role; clients live
            inside the Sales, Presales and Projects tools.
          </p>
        </div>

        {isAdmin && <UserScopePicker />}

        <CrmModuleHub
          flags={flags}
          counts={counts}
          scopeSuffix={scopeSuffix}
          initialTool={sp.tool ?? null}
        />
      </main>
    </div>
  );
}
