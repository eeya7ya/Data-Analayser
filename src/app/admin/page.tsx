import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
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
  if (!canReadAll(user)) redirect("/quotation");
  const readOnly = user.role !== "admin";
  const settings = await settingsPromise;
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6 lg:px-10">
        <h1 className="text-2xl font-bold text-magic-ink mb-4">Admin</h1>
        {readOnly && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            You&apos;re signed in as a <strong>viewer</strong>. Every tab is
            visible, but Save / Create / Delete actions are disabled.
          </div>
        )}
        <AdminTabs initialSettings={settings} readOnly={readOnly} />
      </main>
    </div>
  );
}
