import Link from "next/link";
import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import TrashView from "@/components/TrashView";

export const dynamic = "force-dynamic";

/**
 * /crm/trash — soft-deleted companies, client folders and quotations in
 * one place. Replaces the old Trash entry point that bounced the user
 * into the legacy /quotation?tab=trash list view.
 */
export default async function CrmTrashPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-5xl mx-auto px-6 py-8 lg:px-10 space-y-5">
        <div>
          <div className="text-xs text-magic-ink/50">
            <Link href="/" className="hover:text-magic-red">
              Dashboard
            </Link>{" "}
            <span>→</span>{" "}
            <Link href="/crm" className="hover:text-magic-red">
              CRM
            </Link>{" "}
            <span>→</span>{" "}
            <Link href="/crm/company" className="hover:text-magic-red">
              Companies
            </Link>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-magic-ink">Trash</h1>
          <p className="mt-1 text-sm text-magic-ink/60">
            Restore a deleted company, client or quotation — or remove it for
            good. Nothing here auto-purges.
          </p>
        </div>
        <TrashView isAdmin={canReadAll(user)} />
      </main>
    </div>
  );
}
