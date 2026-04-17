import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import TopBar from "@/components/TopBar";
import AdminTabs from "@/components/AdminTabs";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Kick the settings fetch off in parallel with the auth check so its
  // DB round-trip overlaps with the JWT verification. `fresh: true`
  // bypasses the per-instance cache so the admin always seeds the form
  // from the latest persisted row — on Vercel each lambda keeps its own
  // cache, so without a fresh read a reload landing on a different
  // instance would render pre-save values.
  const settingsPromise = getAppSettings({ fresh: true });
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/quotation");
  const settings = await settingsPromise;
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-5xl mx-auto px-6 py-6 lg:px-10">
        <h1 className="text-2xl font-bold text-magic-ink mb-4">Admin</h1>
        <AdminTabs initialSettings={settings} />
      </main>
    </div>
  );
}
