import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import TopBar from "@/components/TopBar";
import TechnicalProposalView from "@/components/TechnicalProposalView";

export const dynamic = "force-dynamic";

interface SearchParams {
  id?: string;
}

/**
 * /technical-proposal?id=<n> — printable Technical Proposal view for
 * the given quotation, modelled on the Word template. Auto-fetches
 * each BoM row's detailed description from the catalogue and exposes
 * click-to-upload slots for every diagram / certificate. Auth-gated;
 * row data comes from the client-side /api/quotations call so the
 * existing owner / read-all checks still apply.
 */
export default async function TechnicalProposalPage({
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
        <TechnicalProposalView quotationId={id} />
      </main>
    </div>
  );
}
