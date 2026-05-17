import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { canCreateLead } from "@/lib/leads";
import TopBar from "@/components/TopBar";
import LeadsClient from "@/components/LeadsClient";

export const dynamic = "force-dynamic";

/**
 * Lead pipeline landing page. Three views (Waiting on me / My leads /
 * All leads) plus per-status filter pills. Server side we only resolve
 * the session and the create-permission so the client can decide
 * whether to show the "+ New lead" button — the actual list is fetched
 * client-side via /api/leads.
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
          <h1 className="text-2xl font-bold text-magic-ink">Leads</h1>
          <p className="mt-1 text-sm text-magic-ink/60">
            End-to-end pipeline — open a lead, route it through presales, close it
            with sales, and hand the BOQ off for execution. Every transition emails
            the next person responsible.
          </p>
        </header>
        <LeadsClient canCreate={create} />
      </main>
    </div>
  );
}
