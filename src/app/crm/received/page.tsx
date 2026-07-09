import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, canReadAll } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { getUserModuleRoles } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import ReceivedQuotationsClient from "@/components/ReceivedQuotationsClient";

export const dynamic = "force-dynamic";

/**
 * /crm/received — the salesperson's received-quotations queue. Quotations
 * presales hand over with "Send to sales" land here for the chosen recipient
 * (the receiving side of that handoff, which previously surfaced nowhere).
 * From a received quotation the salesperson files it under a Company / Client
 * → Project — the same pick-or-create flow presales use to claim a lead.
 *
 * Gated to CRM sales / sales_manager (the people quotations are sent to) and
 * admin (who can see every received quotation).
 */
export default async function ReceivedQuotationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const isAdmin = canReadAll(user);
  const grants = await getUserModuleRoles(user.id);
  const isSales = grants.some(
    (g) =>
      g.module === "crm" && (g.role === "sales" || g.role === "sales_manager"),
  );
  if (!isAdmin && !isSales) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="mx-auto max-w-2xl px-6 py-10 text-center">
          <h1 className="mb-2 text-xl font-bold text-magic-ink">
            Received quotations
          </h1>
          <p className="text-sm text-magic-ink/60">
            You need a sales role to see quotations sent to you.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-magic-soft/30">
      <TopBar user={user} />
      <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
        <header className="mb-5">
          <div className="text-xs text-magic-ink/50">
            <Link href="/" className="hover:text-magic-red">
              Dashboard
            </Link>{" "}
            <span>→</span>{" "}
            <Link href="/crm?tool=sales" className="hover:text-magic-red">
              CRM
            </Link>{" "}
            <span>→</span> Received quotations
          </div>
          <h1 className="mt-1 text-2xl font-bold text-magic-ink">
            Received quotations
          </h1>
          <p className="mt-1 text-sm text-magic-ink/60">
            Quotations presales sent to you. Open one and file it — pick or
            create the company, the client, then the project — the same way a
            lead is claimed.
          </p>
        </header>
        <ReceivedQuotationsClient />
      </main>
    </div>
  );
}
