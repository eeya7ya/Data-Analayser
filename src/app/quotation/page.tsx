import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import QuotationViewer from "@/components/QuotationViewer";
import FolderExportImport from "@/components/FolderExportImport";
import QuotationListClient from "@/components/QuotationListClient";

export const dynamic = "force-dynamic";

interface SearchParams {
  id?: string;
}

export default async function QuotationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const sp = await searchParams;

  // Single-quotation view still needs the server-side lookup because it
  // drives the full printable document. The list view (no id) is handled
  // entirely client-side so nav to /quotation is instant.
  if (sp.id) {
    await ensureSchema();
    const q = sql();
    const rows = (await q`
      select * from quotations where id = ${Number(sp.id)} limit 1
    `) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (
      row &&
      user.role !== "admin" &&
      Number(row.owner_id) !== user.id
    ) {
      return (
        <div className="min-h-screen bg-magic-soft/40">
          <TopBar user={user} />
          <main className="max-w-5xl mx-auto p-6">
            <p className="text-sm text-magic-ink/70">
              You don&apos;t have access to this quotation.
            </p>
          </main>
        </div>
      );
    }
    if (!row) {
      return (
        <div className="min-h-screen bg-magic-soft/40">
          <TopBar user={user} />
          <main className="max-w-5xl mx-auto p-6">
            <p className="text-sm text-magic-ink/70">Quotation not found.</p>
          </main>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <div className="no-print">
          <TopBar user={user} />
        </div>
        <main className="max-w-5xl mx-auto p-6">
          <QuotationViewer row={row} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-magic-ink">
            Saved Quotations
          </h1>
          <FolderExportImport />
        </div>
        <QuotationListClient isAdmin={user.role === "admin"} />
      </main>
    </div>
  );
}
