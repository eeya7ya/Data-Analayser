import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import QuotationViewer from "@/components/QuotationViewer";
import FolderExportImport from "@/components/FolderExportImport";
import FolderManager from "@/components/FolderManager";
import MoveToFolder from "@/components/MoveToFolder";
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

  // Build folder lookup
  const folderMap = new Map(folders.map((f) => [f.id, f.name]));

  // Group quotations by folder
  const grouped = new Map<number | null, typeof rows>();
  for (const r of rows) {
    const key = r.folder_id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  // Order: named folders first (alphabetical), then unfiled
  const folderOrder: (number | null)[] = [];
  for (const f of folders) {
    if (grouped.has(f.id)) folderOrder.push(f.id);
  }
  if (grouped.has(null)) folderOrder.push(null);

  const foldersForMove = folders.map((f) => ({ id: f.id, name: f.name }));

  function formatDateTime(dt: string) {
    const d = new Date(dt);
    const date = d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const time = d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    return { date, time };
  }

  function renderTable(items: typeof rows) {
    return (
      <table className="w-full text-sm">
        <thead className="bg-magic-header text-magic-red text-xs uppercase">
          <tr>
            <th className="p-3 text-left">Ref</th>
            <th className="p-3 text-left">Project</th>
            <th className="p-3 text-left">Client</th>
            <th className="p-3 text-left">Site</th>
            <th className="p-3 text-left">Created</th>
            <th className="p-3 text-left">Last Edited</th>
            <th className="p-3"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const created = formatDateTime(r.created_at);
            const updated = formatDateTime(r.updated_at);
            const wasEdited = r.updated_at !== r.created_at;
            return (
              <tr key={r.id} className="border-t border-magic-border">
                <td className="p-3 font-mono">
                  <Link
                    href={`/quotation?id=${r.id}`}
                    className="text-magic-red hover:underline"
                  >
                    {r.ref}
                  </Link>
                </td>
                <td className="p-3">{r.project_name}</td>
                <td className="p-3">{r.client_name || "—"}</td>
                <td className="p-3">{r.site_name}</td>
                <td className="p-3 text-xs text-magic-ink/60">
                  <div>{created.date}</div>
                  <div className="text-magic-ink/40">{created.time}</div>
                </td>
                <td className="p-3 text-xs text-magic-ink/60">
                  {wasEdited ? (
                    <>
                      <div>{updated.date}</div>
                      <div className="text-magic-ink/40">{updated.time}</div>
                    </>
                  ) : (
                    <span className="text-magic-ink/30">—</span>
                  )}
                </td>
                <td className="p-3 text-right">
                  <MoveToFolder
                    quotationId={r.id}
                    currentFolderId={r.folder_id}
                    folders={foldersForMove}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
          {user.role === "admin" && <FolderExportImport />}
        </div>

        {/* Folder Manager */}
        <FolderManager
          folders={folders.map((f) => ({
            id: f.id,
            name: f.name,
            created_at: f.created_at,
            updated_at: f.updated_at,
          }))}
          isAdmin={user.role === "admin"}
        />

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-magic-border bg-white p-6 text-center text-magic-ink/50">
            No quotations yet. Go to{" "}
            <Link href="/designer" className="text-magic-red underline">
              the Designer
            </Link>{" "}
            to create one.
          </div>
        ) : (
          <div className="space-y-4">
            {folderOrder.map((fid) => {
              const items = grouped.get(fid)!;
              const folderName =
                fid === null ? "Unfiled" : folderMap.get(fid) || "Unknown";
              return (
                <details
                  key={fid ?? "unfiled"}
                  open
                  className="rounded-2xl border border-magic-border bg-white overflow-hidden"
                >
                  <summary className="p-3 font-semibold text-magic-ink cursor-pointer bg-magic-header flex items-center gap-2 select-none">
                    <svg
                      className="w-4 h-4 text-magic-ink/60"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                      />
                    </svg>
                    {folderName}
                    <span className="text-xs font-normal text-magic-ink/50">
                      ({items.length} quotation
                      {items.length !== 1 ? "s" : ""})
                    </span>
                  </summary>
                  {renderTable(items)}
                </details>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
