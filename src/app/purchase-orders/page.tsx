import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import PurchaseOrdersClient from "@/components/PurchaseOrdersClient";

export const dynamic = "force-dynamic";

interface SearchParams {
  id?: string;
  project?: string;
}

/**
 * Purchase Orders surface. V1.4C retired the standalone cross-client PO list
 * (it used to sit in the nav) and the quotation→PO conversion. POs now live
 * inside the CRM: this page is reached from a CRM project's "Purchase Orders"
 * tab via `?project=<id>` (manage that project's POs) or `?id=<id>` (open a
 * specific PO). Reaching it without that context — the old flat list, or the
 * retired `?quotation=` convert deep-link — forwards into the CRM.
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
  // No project / PO context = the old cross-client list (or the retired
  // convert link). The flat list is gone — send the user into the CRM.
  if (!sp.id && !sp.project) {
    redirect("/crm");
  }

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-screen-2xl mx-auto px-6 py-6 lg:px-10">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-magic-ink">Purchase Orders</h1>
        </div>
        <PurchaseOrdersClient isAdmin={canReadAll(user)} />
      </main>
    </div>
  );
}
