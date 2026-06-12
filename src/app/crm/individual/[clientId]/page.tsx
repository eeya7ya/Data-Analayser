import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { getCrmCaps } from "@/lib/modules";
import { sql, ensureSchema } from "@/lib/db";
import { userHasLeadAccessToFolder } from "@/lib/leads";
import { userHasAssignedProjectInFolder } from "@/lib/projectAccess";
import TopBar from "@/components/TopBar";
import FolderProjectsClient from "@/components/FolderProjectsClient";
import { EditFolderButton } from "@/components/EditFolderDialog";

export const dynamic = "force-dynamic";

/**
 * /crm/individual/[clientId] — single individual client. The folder
 * row IS the client (no Company layer above). Lists this client's
 * projects with inline search + "+ New project". Each row links to
 * /crm/individual/[clientId]/[projectId].
 *
 * If the folder gets reclassified company / unclassified later,
 * redirect to the canonical URL so bookmarks self-heal.
 */
const TOOL_LABELS: Record<string, string> = {
  sales: "Sales",
  presales: "Presales",
  projects: "Projects",
};

export default async function IndividualClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ tool?: string; project?: string; tab?: string }>;
}) {
  const { clientId: clientIdParam } = await params;
  const { tool, project, tab } = await searchParams;
  const initialProjectId = Number(project);
  const toolLabel = tool ? TOOL_LABELS[tool] : undefined;
  const toolQuery = toolLabel ? `?tool=${tool}` : "";
  const folderId = Number(clientIdParam);
  if (!Number.isFinite(folderId)) notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const q = sql();
  const rows = (await q`
    select id, name, owner_id, kind, company_id,
           client_email, client_phone, client_company
    from client_folders
    where id = ${folderId} and deleted_at is null
    limit 1
  `) as Array<{
    id: number;
    name: string;
    owner_id: number | null;
    kind: "company" | "individual" | null;
    company_id: number | null;
    client_email: string | null;
    client_phone: string | null;
    client_company: string | null;
  }>;
  if (rows.length === 0) notFound();
  const folder = rows[0];

  if (folder.kind === "company" && folder.company_id) {
    redirect(`/crm/company/${folder.company_id}/clients/${folderId}`);
  }
  if (folder.kind === "company" && !folder.company_id) {
    // Marked company but unlinked — surface in the legacy folder view.
    redirect(`/folder/${folderId}`);
  }
  // kind === 'individual' OR kind === null — render here.

  if (
    !canReadAll(user) &&
    folder.owner_id !== user.id &&
    !(await userHasLeadAccessToFolder(user.id, folderId)) &&
    !(await userHasAssignedProjectInFolder(user.id, folderId))
  ) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="max-w-3xl mx-auto p-6 text-center">
          <h1 className="text-xl font-bold text-magic-ink mb-2">
            You don&apos;t have access to this client
          </h1>
          <Link
            href="/crm/individual"
            className="inline-block mt-4 rounded-lg border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft transition-colors"
          >
            ← All individuals
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
            {toolLabel && (
              <>
                <span>→</span>{" "}
                <Link
                  href={`/crm?tool=${tool}`}
                  className="hover:text-magic-red"
                >
                  {toolLabel}
                </Link>{" "}
              </>
            )}
            <span>→</span>{" "}
            <Link
              href={`/crm/individual${toolQuery}`}
              className="hover:text-magic-red"
            >
              Individual clients
            </Link>
          </div>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-bold text-magic-ink">
              {folder.name}
              {folder.kind === null && (
                <span className="ml-2 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800 align-middle">
                  Unclassified
                </span>
              )}
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
          </div>
          <div className="mt-1 text-xs text-magic-ink/60 flex flex-wrap gap-x-4 gap-y-1">
            {folder.client_email && <span>{folder.client_email}</span>}
            {folder.client_phone && <span>{folder.client_phone}</span>}
          </div>
        </div>

        <FolderProjectsClient
          folderId={folder.id}
          folderName={folder.name}
          initialProjectId={
            Number.isFinite(initialProjectId) && initialProjectId > 0
              ? initialProjectId
              : undefined
          }
          initialTab={tab}
          initialCaps={await getCrmCaps(user)}
        />
      </main>
    </div>
  );
}
