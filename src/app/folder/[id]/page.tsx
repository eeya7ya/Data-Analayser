import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import FolderProjectsClient from "@/components/FolderProjectsClient";

/**
 * Per-client (folder) page that exposes the new Project layer added by
 * the projects_foundation_v1 migration. Layout:
 *
 *   Client header (name, contact info)
 *     │
 *     ├── Projects sidebar — auto-creates a Default Project per folder
 *     │   on first visit and lets the user rename / add more.
 *     │
 *     └── Selected Project pane — three tabs:
 *           • Quotations  — every quotation filed under the project
 *           • Purchase Orders
 *           • Files       — Quotation / PO / BOQ / Other uploads via
 *                           Supabase Storage signed URLs.
 *
 * The existing /quotation list page is untouched. A "Open as project"
 * link there points users at this page, but legacy flows keep working.
 */
export const dynamic = "force-dynamic";

interface PageParams {
  id: string;
}

export default async function FolderPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();
  const { id: idParam } = await params;
  const folderId = Number(idParam);
  if (!Number.isFinite(folderId) || folderId <= 0) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="max-w-5xl mx-auto p-6">
          <p className="text-sm text-magic-ink/70">
            Invalid folder id.
          </p>
        </main>
      </div>
    );
  }
  const q = sql();
  const folderRows = (await q`
    select id, name, owner_id, client_email, client_phone, client_company
    from client_folders
    where id = ${folderId} and deleted_at is null
    limit 1
  `) as Array<{
    id: number;
    name: string;
    owner_id: number | null;
    client_email: string | null;
    client_phone: string | null;
    client_company: string | null;
  }>;
  const folder = folderRows[0];
  if (!folder) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="max-w-5xl mx-auto p-6">
          <p className="text-sm text-magic-ink/70">Client folder not found.</p>
          <Link
            href="/quotation"
            className="text-magic-red underline text-sm mt-2 inline-block"
          >
            ← Back to clients
          </Link>
        </main>
      </div>
    );
  }
  if (user.role !== "admin" && folder.owner_id !== user.id) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="max-w-5xl mx-auto p-6">
          <p className="text-sm text-magic-ink/70">
            You don&apos;t have access to this client.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-screen-2xl mx-auto px-6 py-6 lg:px-10">
        <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <Link
              href="/quotation"
              className="text-xs text-magic-ink/60 hover:text-magic-red"
            >
              ← All clients
            </Link>
            <h1 className="mt-1 text-2xl font-bold text-magic-ink">
              {folder.name}
            </h1>
            <div className="mt-1 text-xs text-magic-ink/60 flex flex-wrap gap-x-4 gap-y-1">
              {folder.client_company && <span>{folder.client_company}</span>}
              {folder.client_email && <span>{folder.client_email}</span>}
              {folder.client_phone && <span>{folder.client_phone}</span>}
            </div>
          </div>
        </div>
        <FolderProjectsClient folderId={folder.id} folderName={folder.name} />
      </main>
    </div>
  );
}
