import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import TopBar from "@/components/TopBar";
import FinancialProposalView from "@/components/FinancialProposalView";

export const dynamic = "force-dynamic";

interface SearchParams {
  id?: string;
}

/**
 * /financial-proposal?id=<n> — printable Financial Proposal view for the
 * given quotation, rendered to match the Word template sales delivers to
 * clients (cover, TOC, About Us, Contact Details, items table, T&C).
 *
 * Auth-gated; the actual quotation row is fetched client-side from
 * /api/quotations so the existing owner / read-all checks still apply
 * (and the page can keep its print-pipeline shape consistent with
 * /quotation?id=).
 */
export default async function FinancialProposalPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const id = Number(sp.id);
  if (!Number.isFinite(id) || id <= 0) {
    redirect("/crm");
  }

  return (
    <div className="min-h-screen bg-magic-soft/40 print-root">
      <div className="no-print">
        <TopBar user={user} />
      </div>
      <main className="max-w-5xl mx-auto p-6 print-main">
        <FinancialProposalView quotationId={id} />
      </main>
    </div>
  );
}
