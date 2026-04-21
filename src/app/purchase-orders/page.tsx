import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import PurchaseOrdersClient from "@/components/PurchaseOrdersClient";

export const dynamic = "force-dynamic";

interface SearchParams {
  quotation?: string;
}

/**
 * Purchase Orders landing page. Each quotation can evolve into one or more
 * POs once the client signs off, and this surface lets the user list /
 * create / edit them in one place. The client component does its own fetch
 * so the page shell streams immediately — no server-preload round-trip.
 */
export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Fire the schema bootstrap in parallel with the auth check so the table
  // is guaranteed to exist by the time the first PO fetch runs.
  void ensureSchema();

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const sp = await searchParams;

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-screen-2xl mx-auto px-6 py-6 lg:px-10">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-magic-ink">Purchase Orders</h1>
        </div>
        <PurchaseOrdersClient
          isAdmin={user.role === "admin"}
          prefillQuotationId={sp.quotation ?? null}
        />
      </main>
    </div>
  );
}
