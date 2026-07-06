import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { hasModuleRole } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import ChecklistDesignerClient from "@/components/ChecklistDesignerClient";

export const dynamic = "force-dynamic";

/**
 * Checklist Designer — where a project manager designs reusable "master job"
 * checklists. Selecting a master job while distributing seeds that project's
 * checklist automatically. Admin / projects manager only.
 */
export default async function ChecklistDesignerPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const allowed =
    user.role === "admin" ||
    (await hasModuleRole(user.id, "projects", "manager"));

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5">
          <Link href="/crm" className="text-xs text-magic-ink/50 hover:text-magic-red">
            ← CRM
          </Link>
        </div>
        {allowed ? (
          <ChecklistDesignerClient />
        ) : (
          <div className="rounded-2xl border border-magic-border bg-white p-8 text-center">
            <p className="text-sm text-magic-ink/60">
              The Checklist Designer is available to project managers. Ask an
              admin for the projects manager role.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
