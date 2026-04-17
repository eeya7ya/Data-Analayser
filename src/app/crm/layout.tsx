import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import { ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import CrmSidebar from "@/components/CrmSidebar";

export const dynamic = "force-dynamic";

/**
 * Shared shell for every /crm/* route. Centralises three checks:
 *   1. Authenticated session — bounce to /login.
 *   2. CRM module enabled in app_settings — render a "module disabled" notice
 *      so even direct URL visits never expose the CRM surface when the flag
 *      is off. This is the kill-switch contract used for instant rollback.
 *   3. Schema bootstrap — guarantees the CRM tables exist before any nested
 *      page or client component issues a request.
 */
export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  await ensureSchema();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const settings = await getAppSettings();

  if (!settings.crmModuleEnabled) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="max-w-3xl mx-auto p-10 text-center">
          <h1 className="text-2xl font-bold text-magic-ink mb-2">CRM module disabled</h1>
          <p className="text-sm text-magic-ink/70">
            An administrator can enable the CRM in <strong>Admin → Settings</strong>.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <div className="max-w-screen-2xl mx-auto flex gap-0">
        <CrmSidebar isAdmin={user.role === "admin"} />
        <main className="flex-1 px-6 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
