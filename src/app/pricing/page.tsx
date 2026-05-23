import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { requireModuleAllowLegacy } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import PricingDashboardClient from "@/components/pricing/PricingDashboardClient";
import { PricingAuthProvider } from "@/lib/pricing/authContext";

export const dynamic = "force-dynamic";

/**
 * Pricing module landing page. Renders the list of manufacturers the
 * caller can see, in the host's TopBar shell. The actual UI is a
 * client component imported from the pricing-sheet port — wrapped in
 * PricingAuthProvider so its `useAuth()` calls resolve against the
 * host session instead of pricing-sheet's defunct password flow.
 */
export default async function PricingHome() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();
  // requireModuleAllowLegacy throws on FORBIDDEN — translate to a
  // redirect rather than a 500 so users without the grant land back on
  // a useful page.
  try {
    await requireModuleAllowLegacy(user, "pricing");
  } catch {
    redirect("/");
  }
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <PricingAuthProvider>
        <PricingDashboardClient />
      </PricingAuthProvider>
    </div>
  );
}
