import Link from "next/link";
import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { getUserModuleRoles } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import SalesPipelineClient from "@/components/SalesPipelineClient";

export const dynamic = "force-dynamic";

/**
 * /crm/sales-pipeline — the sales person's Held / Won / Lost board. Lets
 * them track and analyse the deals they marked Accepted / Rejected / Held
 * for Execution. Opening it also runs the held-transfer sweep server-side.
 */
export default async function SalesPipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const isAdmin = canReadAll(user);
  const grants = await getUserModuleRoles(user.id);
  const isSales =
    isAdmin ||
    grants.some(
      (g) =>
        g.module === "crm" && (g.role === "sales" || g.role === "sales_manager"),
    );
  if (!isSales) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="mx-auto max-w-2xl px-6 py-10 text-center">
          <h1 className="mb-2 text-xl font-bold text-magic-ink">Sales pipeline</h1>
          <p className="text-sm text-magic-ink/60">
            You need a sales role to see the Held / Won / Lost pipeline.
          </p>
        </main>
      </div>
    );
  }

  const sp = await searchParams;

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <div>
          <div className="text-xs text-magic-ink/50">
            <Link href="/" className="hover:text-magic-red">
              Dashboard
            </Link>{" "}
            <span>→</span>{" "}
            <Link href="/crm?tool=sales" className="hover:text-magic-red">
              CRM
            </Link>{" "}
            <span>→</span> Sales pipeline
          </div>
          <h1 className="mt-1 text-2xl font-bold text-magic-ink">
            Sales pipeline
          </h1>
          <p className="mt-0.5 text-sm text-magic-ink/60">
            Deals you marked Held for Execution, Won, or Lost. Held deals with a
            scheduled time transfer to the projects team automatically.
          </p>
        </div>

        <SalesPipelineClient initialBucket={sp.bucket ?? null} />
      </main>
    </div>
  );
}
