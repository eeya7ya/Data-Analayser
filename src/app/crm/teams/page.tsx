import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import TeamsList from "@/components/crm/TeamsList";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/crm");
  return <TeamsList />;
}
