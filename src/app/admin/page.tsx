import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import TopBar from "@/components/TopBar";
import AdminTabs from "@/components/AdminTabs";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/designer");
  const settings = await getAppSettings();
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold text-magic-ink mb-4">Admin</h1>
        <AdminTabs initialSettings={settings} />
      </main>
    </div>
  );
}
