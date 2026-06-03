import Link from "next/link";
import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { hasModule, hasModuleRole } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import StoragePanel from "@/components/StoragePanel";

export const dynamic = "force-dynamic";

/**
 * Storage module landing page. Server only checks access and hands off
 * to the StoragePanel client component which fetches everything via
 * the /api/storage/* endpoints (so the same panel works for the
 * read-only projects-module viewer and the read-write storage manager
 * with role-aware button rendering).
 */
export default async function StoragePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  await ensureSchema();

  const isAdmin = canReadAll(user);
  const hasStorage = isAdmin || (await hasModule(user.id, "storage"));
  const hasProjects = isAdmin || (await hasModule(user.id, "projects"));
  const canManage =
    isAdmin || (await hasModuleRole(user.id, "storage", "manager"));

  if (!hasStorage && !hasProjects) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="max-w-3xl mx-auto px-6 py-10 text-center">
          <h1 className="text-xl font-bold text-magic-ink mb-2">
            Storage module
          </h1>
          <p className="text-sm text-magic-ink/60">
            You need <code className="text-xs bg-magic-soft px-1 rounded">storage.*</code>{" "}
            or <code className="text-xs bg-magic-soft px-1 rounded">projects.*</code>{" "}
            access to view inventory. Ask an admin in the Modules tab.
          </p>
          <Link
            href="/crm"
            className="inline-block mt-4 rounded-lg border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft"
          >
            Back to CRM
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-6xl mx-auto px-6 py-6 lg:px-10">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-magic-ink">Storage</h1>
            <p className="text-sm text-magic-ink/60 mt-0.5">
              {canManage
                ? "Manage warehouses, stock levels, and request inbox."
                : hasStorage
                  ? "Read-only inventory view."
                  : "Request inventory for your assigned projects."}
            </p>
          </div>
        </div>
        <StoragePanel canManage={canManage} hasProjectsModule={hasProjects} />
      </main>
    </div>
  );
}
