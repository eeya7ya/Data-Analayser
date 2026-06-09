import Link from "next/link";
import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { hasModule } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import StoragePanel from "@/components/StoragePanel";

export const dynamic = "force-dynamic";

/**
 * Storage module landing page → the storage team's Stock-checks inbox
 * (BOQ availability requests filed from quotations). V1.5A removed the
 * legacy flat inventory (locations / stock / requests); the new
 * event-sourced stock module (docs/storage-module-v1.5A.md) will live in
 * the /crm/storage workspace. Gated to storage.* and admins.
 */
export default async function StoragePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  await ensureSchema();

  const isAdmin = canReadAll(user);
  const hasStorage = isAdmin || (await hasModule(user.id, "storage"));

  if (!hasStorage) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="max-w-3xl mx-auto px-6 py-10 text-center">
          <h1 className="text-xl font-bold text-magic-ink mb-2">
            Storage module
          </h1>
          <p className="text-sm text-magic-ink/60">
            You need <code className="text-xs bg-magic-soft px-1 rounded">storage.*</code>{" "}
            access to open the stock-checks inbox. Ask an admin in the Modules
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
      <main className="max-w-6xl mx-auto px-6 py-6 lg:px-10">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-magic-ink">Stock checks</h1>
            <p className="text-sm text-magic-ink/60 mt-0.5">
              BOQ availability requests from quotations — answer Available /
              Partial / Out per item.
            </p>
          </div>
        </div>
        <StoragePanel />
      </main>
    </div>
  );
}
