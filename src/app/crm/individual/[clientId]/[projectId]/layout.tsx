import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { loadAccessibleProject } from "@/lib/projectAccess";
import ProjectDrillDownShell, {
  NoProjectAccess,
} from "@/components/ProjectDrillDownShell";

export const dynamic = "force-dynamic";

export default async function IndividualProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ clientId: string; projectId: string }>;
}) {
  const { clientId, projectId } = await params;
  const folderId = Number(clientId);
  const projId = Number(projectId);
  if (!Number.isFinite(folderId) || !Number.isFinite(projId)) notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const project = await loadAccessibleProject(user, projId, folderId);
  if (!project) {
    return (
      <NoProjectAccess
        user={user}
        fallbackHref={`/crm/individual/${folderId}`}
        fallbackLabel="Back to client"
      />
    );
  }

  // Folder reclassified — redirect to the canonical URL.
  if (project.folder_kind === "company" && project.folder_company_id) {
    redirect(
      `/crm/company/${project.folder_company_id}/clients/${folderId}/${projId}`,
    );
  }
  if (project.folder_kind === "company" && !project.folder_company_id) {
    redirect(`/crm/unclassified/${folderId}/${projId}`);
  }

  const base = `/crm/individual/${folderId}/${projId}`;

  return (
    <ProjectDrillDownShell
      user={user}
      project={project}
      base={base}
      breadcrumb={[
        { href: "/", label: "Dashboard" },
        { href: "/crm", label: "CRM" },
        { href: "/crm/individual", label: "Individual clients" },
        { href: `/crm/individual/${folderId}`, label: project.folder_name },
      ]}
    >
      {children}
    </ProjectDrillDownShell>
  );
}
