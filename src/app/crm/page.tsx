import Link from "next/link";
import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import CrmSearch from "@/components/CrmSearch";
import UserScopePicker from "@/components/UserScopePicker";

export const dynamic = "force-dynamic";

interface SearchParams {
  user?: string;
}

/**
 * /crm — the single CRM tab. Two big drill-down entries (Company /
 * Individual), an approvals banner for managers, and a count strip
 * showing how many folders + quotations live behind each kind. The
 * "Unclassified folders" callout sends admins to the migration
 * quarantine queue (Admin → Folders) for any folder whose `kind` is
 * still NULL.
 *
 * Admins / viewers can scope the cards to a single user via
 * `?user=<id>` (the UserScopePicker writes this). Non-admins are
 * always scoped to themselves and never see the picker.
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
  const requestedScope =
    isAdmin && sp.user ? Number(sp.user) : null;
  const scopeOwnerId = isAdmin
    ? Number.isFinite(requestedScope) && requestedScope! > 0
      ? requestedScope
      : null
    : user.id;
  const q = sql();

  type CountRow = {
    company_entities: number;
    company_clients: number;
    individual_folders: number;
    unclassified_folders: number;
    company_quotations: number;
    individual_quotations: number;
    unclassified_quotations: number;
  };
  // A single query with a conditional `owner_id = $scope` predicate
  // covers all three cases: admin "all users" (scope = null), admin
  // drilling into one user (scope = id), or a regular user pinned to
  // self. Keeps the SQL surface tiny while letting admins flip
  // between users via the picker without a route swap.
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
      (select count(*) from client_folders
         where deleted_at is null and kind is null
           and (${scopeOwnerId}::int is null or owner_id = ${scopeOwnerId})) as unclassified_folders,
      (select count(*) from quotations qq
         join client_folders cf on cf.id = qq.folder_id
         where qq.deleted_at is null and cf.deleted_at is null and cf.kind = 'company'
           and (${scopeOwnerId}::int is null or cf.owner_id = ${scopeOwnerId})) as company_quotations,
      (select count(*) from quotations qq
         join client_folders cf on cf.id = qq.folder_id
         where qq.deleted_at is null and cf.deleted_at is null and cf.kind = 'individual'
           and (${scopeOwnerId}::int is null or cf.owner_id = ${scopeOwnerId})) as individual_quotations,
      (select count(*) from quotations qq
         join client_folders cf on cf.id = qq.folder_id
         where qq.deleted_at is null and cf.deleted_at is null and cf.kind is null
           and (${scopeOwnerId}::int is null or cf.owner_id = ${scopeOwnerId})) as unclassified_quotations
  `) as CountRow[];
  const counts = countsRows[0];

  // Pending-approval banner moved to the TopBar notification bell so
  // this page only renders drill-down cards now.

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-5xl mx-auto px-6 py-8 lg:px-10 space-y-6">
        <div>
          <Link
            href="/"
            className="text-xs text-magic-ink/50 hover:text-magic-red"
          >
            ← Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-magic-ink mt-1">CRM</h1>
          <p className="text-sm text-magic-ink/60 mt-0.5">
            Drill in by client kind. Each path: Company / Individual →
            client → project → Quotations · POs · BOQs.
          </p>
        </div>

        {/* Pending approvals now live in the TopBar notification bell so
            the page doesn't repeat the same alert. The list of refs that
            used to render below the banner moved to /inbox/approvals. */}

        <CrmSearch />

        {isAdmin && <UserScopePicker />}

        <div className="grid gap-4 md:grid-cols-2">
          <KindCard
            href={
              scopeOwnerId
                ? `/crm/company?user=${scopeOwnerId}`
                : "/crm/company"
            }
            title="Company"
            count={counts.company_entities}
            clientLabel={`${counts.company_entities} ${counts.company_entities === 1 ? "company" : "companies"} · ${counts.company_clients} client folder${counts.company_clients === 1 ? "" : "s"}`}
            quotations={counts.company_quotations}
            description="Business clients. Each company holds one or more contacts, and each contact has projects + quotations."
          />
          <KindCard
            href={
              scopeOwnerId
                ? `/crm/individual?user=${scopeOwnerId}`
                : "/crm/individual"
            }
            title="Individual"
            count={counts.individual_folders}
            clientLabel={`${counts.individual_folders} ${counts.individual_folders === 1 ? "client" : "clients"}`}
            quotations={counts.individual_quotations}
            description="Personal / residential clients. Each row IS the client — no company layer."
          />
        </div>

        {/* The unclassified-folders alert moved to the TopBar bell. */}
      </main>
    </div>
  );
}

function KindCard({
  href,
  title,
  clientLabel,
  quotations,
  description,
}: {
  href: string;
  title: string;
  count: number;
  clientLabel: string;
  quotations: number;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-magic-border bg-white p-6 hover:border-magic-red hover:shadow-md transition-all"
    >
      <h2 className="text-xl font-bold text-magic-ink">{title}</h2>
      <p className="text-sm text-magic-ink/60 mt-1">{description}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-magic-ink/60">
        <span className="inline-flex items-center rounded-full bg-magic-soft px-2 py-0.5 font-semibold">
          {clientLabel}
        </span>
        <span className="inline-flex items-center rounded-full bg-magic-soft px-2 py-0.5 font-semibold">
          {quotations} quotation{quotations === 1 ? "" : "s"}
        </span>
      </div>
      <p className="mt-3 text-xs font-semibold text-magic-red">Drill in →</p>
    </Link>
  );
}
