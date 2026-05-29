import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { canClaimLead, canCreateLead } from "@/lib/leads";
import { hasModuleRole } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import LeadsClient from "@/components/LeadsClient";

export const dynamic = "force-dynamic";

/**
 * Leads landing page — role-aware (1.4A shared queue).
 *
 *   • Presales (member, manager) / admin → the shared lead queue. Every
 *     lead, claimed or not, with who is currently working it. Claim an
 *     unclaimed lead to start; no manager distribution step.
 *   • Sales (non-presales)                → the leads they opened, to track
 *     which presales person picked each up, plus "+ New lead" (the RFQ).
 */
export default async function LeadsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const isAdmin = canReadAll(user);
  const isPresales = await canClaimLead(user); // any presales role or admin
  const isSales =
    isAdmin ||
    (await hasModuleRole(user.id, "crm", "sales")) ||
    (await hasModuleRole(user.id, "crm", "sales_manager"));
  const canCreate = await canCreateLead(user); // sales roles / admin

  return (
    <div className="min-h-screen bg-magic-soft/30">
      <TopBar user={user} />
      <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
        <header className="mb-5">
          <h1 className="text-2xl font-bold text-magic-ink">
            {isPresales ? "Lead queue" : "My leads"}
          </h1>
          <p className="mt-1 text-sm text-magic-ink/60">
            {isPresales
              ? "The shared presales queue. Claim a lead to start working it — everyone can see who's on each one. From the lead you pick or create the company, the client, then the project."
              : "Requests for quotation you opened. Track which presales person picked each one up and how it's progressing."}
          </p>
        </header>
        <LeadsClient canCreate={canCreate} isPresales={isPresales} userId={user.id} />
      </main>
    </div>
  );
}
