import { redirect } from "next/navigation";
import Link from "next/link";
import { canReadAll, getSessionUser } from "@/lib/auth";
import TopBar from "@/components/TopBar";
import InstallationCalcSetup from "@/components/InstallationCalcSetup";

export const dynamic = "force-dynamic";

/**
 * Admin → Installation Calculator setup. Hosts the preset price book
 * (conduits by size, cable runs, technician day rates, …) that the
 * Designer's Installation Calculator picker draws from. Viewers get the
 * read-only mirror; the API enforces admin on every write regardless.
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
          Preset price book for the Designer&apos;s Installation Calculator —
          conduits, cables, technician fees and any other line items, grouped
          by category. Each line stores cost + margin; the selling price is
          always derived from them.
        </p>
        <InstallationCalcSetup readOnly={user.role !== "admin"} />
      </main>
    </div>
  );
}
