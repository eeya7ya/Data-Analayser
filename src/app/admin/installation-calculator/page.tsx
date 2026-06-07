import { redirect } from "next/navigation";
import Link from "next/link";
import { canReadAll, getSessionUser } from "@/lib/auth";
import TopBar from "@/components/TopBar";

export const dynamic = "force-dynamic";

/**
 * Admin → Installation Calculator. Reserved route.
 *
 * The downstream picker (opened from the Designer toolbar) prices a
 * complete installation — 1st + 2nd + 3rd FIX — by combining predefined
 * conduits, cables, locations, and technician fees. This page will host
 * the catalogues that drive those choices: line-item types, unit prices,
 * defaults, and the labour rate book. For now we render a stable empty
 * shell so the URL is live and bookmarkable while the actual config UI
 * is being built.
 */
export default async function InstallationCalculatorAdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canReadAll(user)) redirect("/crm");
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-10">
        <div className="mb-4 text-xs text-magic-ink/50">
          <Link href="/" className="hover:text-magic-red">
            Dashboard
          </Link>{" "}
          <span>→</span>{" "}
          <Link href="/admin" className="hover:text-magic-red">
            Admin
          </Link>{" "}
          <span>→</span> <span>Installation Calculator</span>
        </div>
        <h1 className="text-2xl font-bold text-magic-ink mb-2">
          Installation Calculator
        </h1>
        <p className="text-sm text-magic-ink/70 mb-6">
          Catalogue of installation line items that the Designer&apos;s
          Installation Calculator picker draws from.
        </p>
        <div className="rounded-2xl border border-dashed border-magic-border bg-white px-6 py-10 text-center">
          <div className="text-base font-semibold text-magic-ink">
            Coming soon
          </div>
          <p className="mt-2 text-sm text-magic-ink/60 max-w-xl mx-auto">
            This page will let admins manage the conduits, cables,
            locations, technician fees, and other line items the calculator
            combines into a single installation row on the quotation.
          </p>
        </div>
      </main>
    </div>
  );
}
