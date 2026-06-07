import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { canClaimLead } from "@/lib/leads";
import TopBar from "@/components/TopBar";
import LeadAssignClient from "@/components/LeadAssignClient";

export const dynamic = "force-dynamic";

/**
 * /leads/[id]/assign — the dedicated assignment page.
 *
 * The leads list page no longer auto-routes anywhere when a lead is
 * clicked: it shows the lead's data inline. The only way into the
 * Company / Individual → Client → Project flow is this page, opened
 * explicitly by pressing "Claim & file" on the list. That makes the
 * filing step a deliberate, undeniable choice — no silent claim, no
 * background routing.
 */
export default async function LeadAssignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const { id } = await params;
  const leadId = Number(id);
  if (!Number.isFinite(leadId) || leadId <= 0) notFound();

  // Server-side gate: only presales / admin can reach the form. Sales
  // who somehow land here go back to the list rather than seeing an
  // unusable form.
  if (!(await canClaimLead(user))) redirect("/leads");

  return (
    <div className="min-h-screen bg-magic-soft/30">
      <TopBar user={user} />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <header className="mb-5">
          <Link
            href="/leads"
            className="text-xs font-semibold uppercase tracking-wide text-magic-ink/50 hover:text-magic-red"
          >
            ← Back to leads
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-magic-ink">
            File this lead under a presales tree
          </h1>
          <p className="mt-1 text-sm text-magic-ink/60">
            Pick the Company / Individual → Client → Project the work belongs
            under. The presales filing is separate from any loose hints sales
            attached.
          </p>
        </header>
        <LeadAssignClient leadId={leadId} />
      </main>
    </div>
  );
}
