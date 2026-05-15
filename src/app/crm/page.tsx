import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";

export const dynamic = "force-dynamic";

/**
 * /crm — the single CRM tab. Two big drill-down entries (Company /
 * Individual), an approvals banner for managers, and a count strip
 * showing how many folders + quotations live behind each kind. The
 * "Unclassified folders" callout sends admins to the migration
 * quarantine queue (Admin → Folders) for any folder whose `kind` is
 * still NULL.
 */
export default async function CrmLandingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  await ensureSchema();

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
  // Company count now reflects rows in the `companies` table — the
  // top of the Company branch — rather than folders tagged company.
  // We also surface client-folder counts so the user knows how many
  // contacts sit beneath all those companies in aggregate.
  const countsRows = (await q`
    select
      (select count(*) from companies where deleted_at is null) as company_entities,
      (select count(*) from client_folders where deleted_at is null and kind = 'company') as company_clients,
      (select count(*) from client_folders where deleted_at is null and kind = 'individual') as individual_folders,
      (select count(*) from client_folders where deleted_at is null and kind is null) as unclassified_folders,
      (select count(*) from quotations qq
         join client_folders cf on cf.id = qq.folder_id
         where qq.deleted_at is null and cf.deleted_at is null and cf.kind = 'company') as company_quotations,
      (select count(*) from quotations qq
         join client_folders cf on cf.id = qq.folder_id
         where qq.deleted_at is null and cf.deleted_at is null and cf.kind = 'individual') as individual_quotations,
      (select count(*) from quotations qq
         join client_folders cf on cf.id = qq.folder_id
         where qq.deleted_at is null and cf.deleted_at is null and cf.kind is null) as unclassified_quotations
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

        <div className="grid gap-4 md:grid-cols-2">
          <KindCard
            href="/crm/company"
            title="Company"
            count={counts.company_entities}
            clientLabel={`${counts.company_entities} ${counts.company_entities === 1 ? "company" : "companies"} · ${counts.company_clients} client folder${counts.company_clients === 1 ? "" : "s"}`}
            quotations={counts.company_quotations}
            description="Business clients. Each company holds one or more contacts, and each contact has projects + quotations."
          />
          <KindCard
            href="/crm/individual"
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
