import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { requireModuleAllowLegacy } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import DeepSearchClient from "@/components/pricing/DeepSearchClient";
import { PricingAuthProvider } from "@/lib/pricing/authContext";

export const dynamic = "force-dynamic";

/**
 * Deep item search page. Lets the user look up a specific item and see
 * every project it appears in, what it cost, and when — sortable by date
 * or cost. Same TopBar shell + host-session auth bridge as the rest of
 * the pricing module.
 */
export default async function PricingDeepSearchPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();
  try {
    await requireModuleAllowLegacy(user, "pricing");
  } catch {
    redirect("/");
  }
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <PricingAuthProvider>
        <DeepSearchClient />
      </PricingAuthProvider>
    </div>
  );
}
