import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import { loadAccessibleProject } from "@/lib/projectAccess";
import ProjectDrillDownShell, {
  NoProjectAccess,
} from "@/components/ProjectDrillDownShell";

export const dynamic = "force-dynamic";

export default async function CompanyProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{
    companyId: string;
    clientId: string;
    projectId: string;
  }>;
}) {
  const { companyId: companyIdParam, clientId, projectId } = await params;
  const companyId = Number(companyIdParam);
  const folderId = Number(clientId);
  const projId = Number(projectId);
  if (!Number.isFinite(companyId)) notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const project = await loadAccessibleProject(user, projId, folderId);
  if (!project) {
    return (
      <NoProjectAccess
        user={user}
        fallbackHref={`/crm/company/${companyId}/clients/${folderId}`}
        fallbackLabel="Back to client"
      />
    );
  }

  // Validate the folder is actually attached to this URL's company.
  // If it's been re-linked or detached, redirect to the canonical URL.
  if (project.folder_company_id !== companyId) {
    if (project.folder_company_id) {
      redirect(
        `/crm/company/${project.folder_company_id}/clients/${folderId}/${projId}`,
      );
    }
    if (project.folder_kind === "individual") {
      redirect(`/crm/individual/${folderId}/${projId}`);
    }
    // Unattached — old URL still works via legacy [kind] route.
    redirect(`/crm/unclassified/${folderId}/${projId}`);
  }

  const q = sql();
  const companyRows = (await q`
    select name from companies where id = ${companyId}
  `) as Array<{ name: string }>;
  const companyName = companyRows[0]?.name ?? `company #${companyId}`;

  const base = `/crm/company/${companyId}/clients/${folderId}/${projId}`;

  return (
    <ProjectDrillDownShell
      user={user}
      project={project}
      base={base}
      breadcrumb={[
        { href: "/", label: "Dashboard" },
        { href: "/crm", label: "CRM" },
        { href: "/crm/company", label: "Companies" },
        { href: `/crm/company/${companyId}`, label: companyName },
        {
          href: `/crm/company/${companyId}/clients/${folderId}`,
          label: project.folder_name,
        },
      ]}
    >
      {children}
    </ProjectDrillDownShell>
  );
}
