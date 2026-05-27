import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import FolderProjectsClient from "@/components/FolderProjectsClient";
import { EditFolderButton } from "@/components/EditFolderDialog";

export const dynamic = "force-dynamic";

/**
 * /crm/company/[companyId]/clients/[clientId] — client (folder) page
 * one level under a Company. Lists this client's projects with
 * inline search + "+ New project". Each project links to the deeper
 * drill-down at /crm/company/[companyId]/clients/[clientId]/[projectId].
 *
 * If the folder's company link drifts after a bookmark was made,
 * redirect to the canonical URL — no folder is ever stranded.
 */
export default async function CompanyClientFolderPage({
  params,
}: {
  params: Promise<{ companyId: string; clientId: string }>;
}) {
  const { companyId: companyIdParam, clientId: clientIdParam } = await params;
  const companyId = Number(companyIdParam);
  const folderId = Number(clientIdParam);
  if (!Number.isFinite(companyId) || !Number.isFinite(folderId)) notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const q = sql();
  const rows = (await q`
    select cf.id, cf.name, cf.owner_id, cf.company_id, cf.kind,
           cf.client_email, cf.client_phone, cf.client_company,
           c.name as company_name
    from client_folders cf
    left join companies c on c.id = cf.company_id and c.deleted_at is null
    where cf.id = ${folderId} and cf.deleted_at is null
    limit 1
  `) as Array<{
    id: number;
    name: string;
    owner_id: number | null;
    company_id: number | null;
    kind: "company" | "individual" | null;
    client_email: string | null;
    client_phone: string | null;
    client_company: string | null;
    company_name: string | null;
  }>;
  if (rows.length === 0) notFound();
  const folder = rows[0];

  if (folder.company_id !== companyId) {
    if (folder.company_id) {
      redirect(`/crm/company/${folder.company_id}/clients/${folderId}`);
    }
    if (folder.kind === "individual") {
      redirect(`/crm/individual/${folderId}`);
    }
    redirect(`/folder/${folderId}`);
  }

  if (!canReadAll(user) && folder.owner_id !== user.id) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="max-w-3xl mx-auto p-6 text-center">
          <h1 className="text-xl font-bold text-magic-ink mb-2">
            You don&apos;t have access to this client
          </h1>
          <Link
            href={`/crm/company/${companyId}`}
            className="inline-block mt-4 rounded-lg border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft transition-colors"
          >
            ← Back to company
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-screen-2xl mx-auto px-6 py-6 lg:px-10">
        <div className="mb-4">
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
            </Link>{" "}
            <span>→</span>{" "}
            <Link
              href={`/crm/company/${companyId}`}
              className="hover:text-magic-red"
            >
              {folder.company_name ?? `company #${companyId}`}
            </Link>
          </div>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-bold text-magic-ink">
              {folder.name}
            </h1>
            <EditFolderButton
              folder={{
                id: folder.id,
                name: folder.name,
                client_email: folder.client_email,
                client_phone: folder.client_phone,
                client_company: folder.client_company,
                kind: folder.kind,
                company_id: folder.company_id,
              }}
            />
            <Link
              href={`/leads/new?folder=${folder.id}&company=${folder.company_id ?? companyId}`}
              className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
            >
              Request for Quotation
            </Link>
          </div>
          <div className="mt-1 text-xs text-magic-ink/60 flex flex-wrap gap-x-4 gap-y-1">
            {folder.client_email && <span>{folder.client_email}</span>}
            {folder.client_phone && <span>{folder.client_phone}</span>}
          </div>
        </div>

        <FolderProjectsClient folderId={folder.id} folderName={folder.name} />
      </main>
    </div>
  );
}
