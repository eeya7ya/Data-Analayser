import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { canCreateLead } from "@/lib/leads";
import TopBar from "@/components/TopBar";
import LeadsClient from "@/components/LeadsClient";

export const dynamic = "force-dynamic";

/**
 * New leads landing page. A lead exists only to be distributed: a presales
 * manager hands each new lead to a presales member, which completes it.
 * Server side we resolve the session and create-permission; the list is
 * fetched client-side via /api/leads.
 */
export default async function LeadsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const create = await canCreateLead(user);

  return (
    <div className="min-h-screen bg-magic-soft/30">
      <TopBar user={user} />
      <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
        <header className="mb-5">
          <h1 className="text-2xl font-bold text-magic-ink">New leads</h1>
          <p className="mt-1 text-sm text-magic-ink/60">
            Intake and distribution. A presales manager distributes each new
            lead to a presales member — once distributed, the lead&apos;s job is
            done and the work continues in the CRM client area.
          </p>
        </header>
        <LeadsClient canCreate={create} />
      </main>
    </div>
  );
}
