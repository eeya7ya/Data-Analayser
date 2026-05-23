import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { requireModuleAllowLegacy } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import CompareClient from "@/components/pricing/CompareClient";
import { PricingAuthProvider } from "@/lib/pricing/authContext";

export const dynamic = "force-dynamic";

export default async function PricingComparePage() {
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
        <CompareClient />
      </PricingAuthProvider>
    </div>
  );
}
