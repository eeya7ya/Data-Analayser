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
    // Users can only view their own quotations; admins can view any.
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

  // Fetch quotations and folders in parallel.
  //
  // Scoping rules:
  //   • Admin → sees everyone's quotations and folders (grouped per owner).
  //   • User  → only their own quotations and their own folders.
  const isAdmin = user.role === "admin";
  const [rows, folders] = await Promise.all([
    isAdmin
      ? (q`
          select q.id, q.ref, q.project_name, q.client_name, q.site_name,
                 q.folder_id, q.owner_id, q.created_at, q.updated_at,
                 u.username as owner_username,
                 u.display_name as owner_display_name
          from quotations q
          left join users u on u.id = q.owner_id
          order by q.id desc
          limit 500
        ` as Promise<
          Array<{
            id: number;
            ref: string;
            project_name: string;
            client_name: string | null;
            site_name: string;
            folder_id: number | null;
            owner_id: number | null;
            created_at: string;
            updated_at: string;
            owner_username: string | null;
            owner_display_name: string | null;
          }>
        >)
      : (q`
          select id, ref, project_name, client_name, site_name,
                 folder_id, owner_id, created_at, updated_at
          from quotations
          where owner_id = ${user.id}
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
            owner_id: number | null;
            created_at: string;
            updated_at: string;
          }>
        >),
    isAdmin
      ? (q`
          select f.id, f.name, f.owner_id, f.created_at, f.updated_at,
                 u.username as owner_username,
                 u.display_name as owner_display_name
          from client_folders f
          left join users u on u.id = f.owner_id
          order by u.username nulls first, f.name asc
        ` as Promise<
          Array<{
            id: number;
            name: string;
            owner_id: number | null;
            created_at: string;
            updated_at: string;
            owner_username: string | null;
            owner_display_name: string | null;
          }>
        >)
      : (q`
          select id, name, owner_id, created_at, updated_at
          from client_folders
          where owner_id = ${user.id}
          order by name asc
        ` as Promise<
          Array<{
            id: number;
            name: string;
            owner_id: number | null;
            created_at: string;
            updated_at: string;
          }>
        >),
  ]);

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
