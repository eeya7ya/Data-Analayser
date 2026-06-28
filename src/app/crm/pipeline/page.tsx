import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { getUserModuleRoles } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import PipelineBoardClient from "@/components/PipelineBoardClient";

export const dynamic = "force-dynamic";

/**
 * /crm/pipeline — the Quote-to-Delivery pipeline. One Kanban across the whole
 * lifecycle (quoting → approval → won/held → execution → delivered), priced
 * with each quotation's real BoQ total and a weighted forecast on top. This is
 * the single pipeline view; the old standalone Held/Won/Lost board
 * (/crm/sales-pipeline) now redirects here.
 */
export default async function PipelinePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  // Admin is deliberately NOT granted access — it is for the entry panel,
  // backups and configuration, not for monitoring deals. Access is a CRM
  // sales / sales_manager grant, OR the read-only `viewer` role: a viewer
  // observes the whole pipeline but cannot act on any deal.
  const grants = await getUserModuleRoles(user.id);
  const isSales = grants.some(
    (g) =>
      g.module === "crm" && (g.role === "sales" || g.role === "sales_manager"),
  );
  const isViewer = user.role === "viewer";
  if (!isSales && !isViewer) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="mx-auto max-w-2xl px-6 py-10 text-center">
          <h1 className="mb-2 text-xl font-bold text-magic-ink">
            Quote-to-Delivery pipeline
          </h1>
          <p className="text-sm text-magic-ink/60">
            You need a sales role to see the pipeline.
          </p>
        </main>
      </div>
    );
  }

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
            <span>→</span> Pipeline
          </div>
          <h1 className="mt-1 text-2xl font-bold text-magic-ink">
            Quote-to-Delivery pipeline
          </h1>
          <p className="mt-0.5 text-sm text-magic-ink/60">
            Every live deal from quote to delivery, valued by its real BoQ total
            with a weighted forecast on top.
          </p>
        </div>

        <PipelineBoardClient readOnly={!isSales} />
      </main>
    </div>
  );
}
