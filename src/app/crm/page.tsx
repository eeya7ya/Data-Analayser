import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import { hasModuleRole } from "@/lib/modules";
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

  const isAdmin = user.role === "admin";
  const isSalesManager =
    isAdmin || (await hasModuleRole(user.id, "crm", "sales_manager"));
  const isPresalesManager =
    isAdmin || (await hasModuleRole(user.id, "crm", "presales_manager"));

  const q = sql();

  type CountRow = {
    company_folders: number;
    individual_folders: number;
    unclassified_folders: number;
    company_quotations: number;
    individual_quotations: number;
    unclassified_quotations: number;
  };
  const countsRows = (await q`
    select
      (select count(*) from client_folders where deleted_at is null and kind = 'company') as company_folders,
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

  let pendingApprovals: Array<{
    id: number;
    ref: string;
    project_name: string;
  }> = [];
  if (isSalesManager || isPresalesManager) {
    pendingApprovals = (await q`
      select id, ref, project_name from quotations
      where deleted_at is null
        and approved_at is null
        and rejected_at is null
        and (
          (${isSalesManager}::boolean and sales_approved_at is null)
          or (${isPresalesManager}::boolean and presales_approved_at is null)
        )
      order by created_at desc
      limit 8
    `) as Array<{ id: number; ref: string; project_name: string }>;
  }

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

        {pendingApprovals.length > 0 && (
          <section className="rounded-2xl border border-magic-red/30 bg-magic-red/5 p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h2 className="text-sm font-semibold text-magic-red">
                {pendingApprovals.length} quotation
                {pendingApprovals.length === 1 ? "" : "s"} need your approval
              </h2>
              <Link
                href="/inbox/approvals"
                className="text-xs font-semibold text-magic-red hover:underline"
              >
                Open inbox →
              </Link>
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {pendingApprovals.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/quotation?id=${p.id}`}
                    className="inline-flex items-center gap-1 rounded-full border border-magic-red/30 bg-white px-2.5 py-1 text-xs hover:bg-magic-red hover:text-white transition-colors"
                  >
                    <span className="font-mono font-semibold">{p.ref}</span>
                    <span className="text-magic-ink/60 group-hover:text-white">
                      {p.project_name}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <KindCard
            href="/crm/company"
            title="Company"
            count={counts.company_folders}
            quotations={counts.company_quotations}
            description="Business clients linked to a row in the companies directory."
          />
          <KindCard
            href="/crm/individual"
            title="Individual"
            count={counts.individual_folders}
            quotations={counts.individual_quotations}
            description="Personal / residential clients."
          />
        </div>

        {counts.unclassified_folders > 0 && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <h2 className="text-sm font-semibold text-amber-800">
              {counts.unclassified_folders} folder
              {counts.unclassified_folders === 1 ? "" : "s"} need classification
              <span className="ml-2 text-xs font-normal text-amber-700/80">
                ({counts.unclassified_quotations} quotation
                {counts.unclassified_quotations === 1 ? "" : "s"} behind them)
              </span>
            </h2>
            <p className="text-xs text-amber-700/80 mt-1">
              These folders existed before V2.0 and haven&apos;t been marked
              Company / Individual yet. They&apos;re NOT lost — pick a path:
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                href="/crm/unclassified"
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
              >
                View unclassified clients
              </Link>
              {isAdmin && (
                <Link
                  href="/admin"
                  className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
                >
                  Admin → Folders quarantine
                </Link>
              )}
              <Link
                href="/quotation"
                className="rounded-lg border border-magic-border bg-white px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft transition-colors"
              >
                Open legacy list
              </Link>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function KindCard({
  href,
  title,
  count,
  quotations,
  description,
}: {
  href: string;
  title: string;
  count: number;
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
      <div className="mt-4 flex items-center gap-3 text-xs text-magic-ink/60">
        <span className="inline-flex items-center rounded-full bg-magic-soft px-2 py-0.5 font-semibold">
          {count} {count === 1 ? "client" : "clients"}
        </span>
        <span className="inline-flex items-center rounded-full bg-magic-soft px-2 py-0.5 font-semibold">
          {quotations} quotation{quotations === 1 ? "" : "s"}
        </span>
      </div>
      <p className="mt-3 text-xs font-semibold text-magic-red">Drill in →</p>
    </Link>
  );
}
