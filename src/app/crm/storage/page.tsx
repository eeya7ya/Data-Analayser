import Link from "next/link";
import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { hasModule, hasModuleRole } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import StorageWorkspace from "@/components/StorageWorkspace";

export const dynamic = "force-dynamic";

/**
 * CRM → Storage tool. The Storage people's workspace: a Catalogue tab
 * (browse every product, build a quotation manually) and a Stock
 * Management tab (placeholder for the V1.5A event-sourced stock module —
 * see docs/storage-module-v1.5A.md). Gated to storage.* and admins. The
 * stock-checks inbox lives at /storage; the legacy flat inventory
 * (Requests / Stock / Locations) was removed in V1.5A.
 */
export default async function CrmStoragePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  await ensureSchema();

  const isAdmin = canReadAll(user);
  const hasStorage = isAdmin || (await hasModule(user.id, "storage"));
  const canManage =
    isAdmin || (await hasModuleRole(user.id, "storage", "manager"));

  if (!hasStorage) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="max-w-3xl mx-auto px-6 py-10 text-center">
          <h1 className="text-xl font-bold text-magic-ink mb-2">Storage</h1>
          <p className="text-sm text-magic-ink/60">
            You need{" "}
            <code className="text-xs bg-magic-soft px-1 rounded">storage.*</code>{" "}
            access to open the Storage workspace. Ask an admin in the Modules
            tab.
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
      <main className="max-w-screen-2xl mx-auto px-6 py-6 lg:px-10">
        <header className="mb-4">
          <Link
            href="/crm?tool=storage"
            className="text-xs text-magic-ink/50 hover:text-magic-red"
          >
            ← CRM
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-magic-ink">Storage</h1>
          <p className="mt-0.5 text-sm text-magic-ink/60">
            Track stock levels, locations, and movements.
          </p>
        </header>
        <StorageWorkspace canManage={canManage} canRecord={hasStorage} />
      </main>
    </div>
  );
}
