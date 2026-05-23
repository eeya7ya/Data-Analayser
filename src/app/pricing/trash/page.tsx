import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { requireModuleAllowLegacy } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import TrashClient from "@/components/pricing/TrashClient";
import { PricingAuthProvider } from "@/lib/pricing/authContext";

export const dynamic = "force-dynamic";

export default async function PricingTrashPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Trash is admin-only on the API; bounce non-admins back to the pricing
  // dashboard rather than rendering the page in a permanently-failed state.
  if (!canReadAll(user)) redirect("/pricing");
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
        <TrashClient />
      </PricingAuthProvider>
    </div>
  );
}
