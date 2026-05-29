import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { canTriageLeads } from "@/lib/leads";
import { hasModuleRole } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import LeadsClient from "@/components/LeadsClient";

export const dynamic = "force-dynamic";

/**
 * Leads landing page — role-aware.
 *
 *   • Presales manager / admin  → the intake & distribution console:
 *     every lead, New / Distributed / All tabs, and lead creation.
 *   • Sales (non-manager)        → the leads they opened, to track
 *     progress, plus "+ New lead".
 *   • Presales engineer          → RECEIVE-only. Just the leads
 *     distributed to them; they open one and do the work (create / pick
 *     the client, project, quotation). No intake, no distribution, no
 *     "+ New lead".
 */
export default async function LeadsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const isAdmin = canReadAll(user);
  const isManager = await canTriageLeads(user); // presales_manager or admin
  const isSales =
    isAdmin ||
    (await hasModuleRole(user.id, "crm", "sales")) ||
    (await hasModuleRole(user.id, "crm", "sales_manager"));

  // Leads are OPENED by sales (and managers/admins). A presales engineer
  // only receives them, so they don't get lead creation.
  const canCreate = isManager || isSales;

  return (
    <div className="min-h-screen bg-magic-soft/30">
      <TopBar user={user} />
      <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
        <header className="mb-5">
          <h1 className="text-2xl font-bold text-magic-ink">
            {isManager ? "New leads" : "My leads"}
          </h1>
          <p className="mt-1 text-sm text-magic-ink/60">
            {isManager
              ? "Intake and distribution. A presales manager distributes each new lead to a presales member — once distributed, the lead's job is done and the work continues in the CRM client area."
              : "Leads handed to you. Open one to assign it to a company or individual, create or pick the client, then start a project and a quotation or pricing."}
          </p>
        </header>
        <LeadsClient canCreate={canCreate} isManager={isManager} />
      </main>
    </div>
  );
}

