import Link from "next/link";
import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import { hasModule, hasModuleRole } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import NewsBar from "@/components/NewsBar";

export const dynamic = "force-dynamic";

/**
 * Main dashboard. The drill-down for client work starts at /crm; this
 * page is where everything else surfaces: announcements, a "you have N
 * approvals waiting" card for managers, and big CTAs into the
 * top-level modules. Legacy pages live behind the Legacy menu in the
 * TopBar so any pre-V2 bookmark still works.
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
  const hasCrm =
    isAdmin || (await hasModule(user.id, "crm")) ||
    // Legacy bypass: pre-V2 users without explicit grants keep CRM access
    (!(await hasModule(user.id, "projects")) &&
      !(await hasModule(user.id, "storage")));
  const hasProjects = isAdmin || (await hasModule(user.id, "projects"));
  const hasStorage = isAdmin || (await hasModule(user.id, "storage"));

  // Approval count — we read directly from the DB rather than going
  // through the API endpoint so the page renders in one round-trip.
  const q = sql();
  let approvalCount = 0;
  if (isSalesManager || isPresalesManager) {
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
    approvalCount =
      Number(rows[0].needs_sales) + Number(rows[0].needs_presales);
  }

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-5xl mx-auto px-6 py-8 lg:px-10">
        <h1 className="text-2xl font-bold text-magic-ink mb-1">
          Welcome back, {user.display_name || user.username}.
        </h1>
        <p className="text-sm text-magic-ink/60 mb-6">
          {isAdmin
            ? "You can administer every module. The Legacy menu in the top bar opens any pre-V2 page."
            : "Pick a module to drill into. The Legacy menu has the pre-V2 pages if you need an old shortcut."}
        </p>

        <NewsBar />

        {approvalCount > 0 && (
          <Link
            href="/inbox/approvals"
            className="block mb-6 rounded-2xl border border-magic-red/30 bg-magic-red/5 p-5 hover:bg-magic-red/10 transition-colors"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-magic-red">
                  {approvalCount}{" "}
                  {approvalCount === 1 ? "quotation needs" : "quotations need"}{" "}
                  your approval
                </h2>
                <p className="text-xs text-magic-ink/60 mt-0.5">
                  Open the inbox to review and sign off.
                </p>
              </div>
              <span className="text-magic-red text-sm font-semibold">
                Open inbox →
              </span>
            </div>
          </Link>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {hasCrm && (
            <ModuleCard
              href="/crm"
              title="CRM"
              description="Clients, projects, quotations, POs, BOQs. Pick Company or Individual to drill in."
              accent="primary"
            />
          )}
          {(hasStorage || hasProjects) && (
            <ModuleCard
              href="/storage"
              title="Storage"
              description="Inventory, locations, and stock requests."
              accent="indigo"
            />
          )}
          {hasProjects && (
            <ModuleCard
              href="/projects"
              title="Projects (flat view)"
              description="Every project you own or are assigned to, across clients. Useful for engineers."
              accent="muted"
            />
          )}
          {isAdmin && (
            <ModuleCard
              href="/admin"
              title="Admin"
              description="Users, module roles, folder classification, announcements, settings, backup."
              accent="muted"
            />
          )}
        </div>
      </main>
    </div>
  );
}

function ModuleCard({
  href,
  title,
  description,
  accent,
}: {
  href: string;
  title: string;
  description: string;
  accent: "primary" | "indigo" | "muted";
}) {
  const tones: Record<typeof accent, string> = {
    primary:
      "border-magic-red/30 bg-gradient-to-br from-magic-red/5 to-white hover:from-magic-red/10",
    indigo:
      "border-indigo-200 bg-gradient-to-br from-indigo-50 to-white hover:from-indigo-100",
    muted: "border-magic-border bg-white hover:bg-magic-soft/30",
  };
  return (
    <Link
      href={href}
      className={`block rounded-2xl border p-5 transition-colors ${tones[accent]}`}
    >
      <h3 className="font-semibold text-magic-ink text-lg">{title}</h3>
      <p className="text-sm text-magic-ink/60 mt-1">{description}</p>
      <p className="mt-3 text-xs font-semibold text-magic-red">Open →</p>
    </Link>
  );
}
