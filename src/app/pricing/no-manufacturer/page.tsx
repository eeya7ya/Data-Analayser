import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import TopBar from "@/components/TopBar";
import NoManufacturerClient from "@/components/pricing/NoManufacturerClient";

export const dynamic = "force-dynamic";

export default async function PricingNoManufacturerPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <NoManufacturerClient />
    </div>
  );
}
