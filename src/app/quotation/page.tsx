import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import QuotationViewer from "@/components/QuotationViewer";
import FolderExportImport from "@/components/FolderExportImport";
import QuotationListClient from "@/components/QuotationListClient";
import Link from "next/link";

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
  await ensureSchema();
  const q = sql();

  if (sp.id) {
    const rows = (await q`
      select * from quotations where id = ${Number(sp.id)} limit 1
    `) as Array<Record<string, unknown>>;
    const row = rows[0];
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

  // Fetch quotations and folders in parallel
  const [rows, folders] = await Promise.all([
    q`
      select id, ref, project_name, client_name, site_name, folder_id, created_at, updated_at
      from quotations
      where owner_id = ${user.id} or ${user.role} = 'admin'
      order by id desc
      limit 200
    ` as Promise<
      Array<{
        id: number;
        ref: string;
        project_name: string;
        client_name: string | null;
        site_name: string;
        folder_id: number | null;
        created_at: string;
        updated_at: string;
      }>
    >,
    q`
      select id, name, created_at, updated_at from client_folders order by name asc
    ` as Promise<Array<{ id: number; name: string; created_at: string; updated_at: string }>>,
  ]);

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-magic-ink">
            Saved Quotations
          </h1>
          {user.role === "admin" && <FolderExportImport />}
        </div>

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-magic-border bg-white p-6 text-center text-magic-ink/50">
            No quotations yet. Go to{" "}
            <Link href="/designer" className="text-magic-red underline">
              the Designer
            </Link>{" "}
            to create one.
          </div>
        ) : (
          <QuotationListClient
            quotations={rows}
            folders={folders}
            isAdmin={user.role === "admin"}
          />
        )}
      </main>
    </div>
  );
}
