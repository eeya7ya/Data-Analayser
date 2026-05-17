import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { canCreateLead } from "@/lib/leads";
import TopBar from "@/components/TopBar";
import LeadCreateForm from "@/components/LeadCreateForm";

export const dynamic = "force-dynamic";

export default async function NewLeadPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  if (!(await canCreateLead(user))) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="mx-auto max-w-2xl px-6 py-10 text-center">
          <h1 className="mb-2 text-xl font-bold text-magic-ink">Open a lead</h1>
          <p className="text-sm text-magic-ink/60">
            You need a CRM role (sales, sales_manager, presales, or
            presales_manager) to open a lead. Ask an admin in Admin → Modules.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-magic-soft/30">
      <TopBar user={user} />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
        <header className="mb-5">
          <Link
            href="/leads"
            className="text-xs font-semibold uppercase tracking-wide text-magic-ink/50 hover:text-magic-red"
          >
            ← Back to leads
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-magic-ink">Open a new lead</h1>
          <p className="mt-1 text-sm text-magic-ink/60">
            Once submitted, the presales manager is emailed to triage and assign
            the lead to a specific presales engineer.
          </p>
        </header>
        <LeadCreateForm />
      </main>
    </div>
  );
}
