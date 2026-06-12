import { redirect } from "next/navigation";
import Link from "next/link";
import { canReadAll, getSessionUser } from "@/lib/auth";
import TopBar from "@/components/TopBar";
import InstallationRatesAdmin from "@/components/InstallationRatesAdmin";

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
          The rate book the Designer&apos;s Installation Calculator draws from.
          Set the cost of each conduit, cable, labour day, location uplift and
          accessory; the calculator combines them into one installation row on
          the quotation.
        </p>
        <InstallationRatesAdmin />
      </main>
    </div>
  );
}
