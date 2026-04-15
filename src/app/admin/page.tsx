import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import TopBar from "@/components/TopBar";
import AdminTabs from "@/components/AdminTabs";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Kick the settings fetch off in parallel with the auth check so its
  // DB round-trip overlaps with the JWT verification instead of running
  // after it. `getAppSettings` has its own short-budget timeout + stale
  // cache fallback so this promise never blocks the page render for long.
  const settingsPromise = getAppSettings();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/quotation");
  const settings = await settingsPromise;
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
