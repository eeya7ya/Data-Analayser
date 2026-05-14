import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { loadAccessibleProject } from "@/lib/projectAccess";
import ProjectDrillDownShell, {
  NoProjectAccess,
} from "@/components/ProjectDrillDownShell";

export const dynamic = "force-dynamic";

/**
 * Legacy [kind]/[clientId]/[projectId] route. Stays alive so old
 * bookmarks keep resolving. New work lives under the deeper
 * /crm/company/[companyId]/clients/[clientId]/[projectId] and
 * /crm/individual/[clientId]/[projectId] trees, but this URL still
 * resolves to the same UI — the shared shell + tab pages handle the
 * actual rendering.
 */
export default async function LegacyProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ kind: string; clientId: string; projectId: string }>;
}) {
  const { kind, clientId, projectId } = await params;
  if (
    kind !== "company" &&
    kind !== "individual" &&
    kind !== "unclassified"
  ) {
    notFound();
  }
  const folderId = Number(clientId);
  const projId = Number(projectId);

  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const project = await loadAccessibleProject(user, projId, folderId);
  if (!project) {
    return (
      <NoProjectAccess user={user} fallbackHref="/crm" fallbackLabel="Back to CRM" />
    );
  }

  // If the folder got re-classified after the URL was bookmarked,
  // redirect to the right kind URL so the breadcrumb stays truthful.
  const actualKindUrl = project.folder_kind ?? "unclassified";
  if (actualKindUrl !== kind) {
    redirect(`/crm/${actualKindUrl}/${folderId}/${projId}`);
  }

  const base = `/crm/${kind}/${folderId}/${projId}`;

  return (
    <ProjectDrillDownShell
      user={user}
      project={project}
      base={base}
      breadcrumb={[
        { href: "/", label: "Dashboard" },
        { href: "/crm", label: "CRM" },
        {
          href: kind === "company" ? "/crm/company" : kind === "individual" ? "/crm/individual" : "/crm/unclassified",
          label: kind,
        },
        { href: `/folder/${folderId}`, label: project.folder_name },
      ]}
    >
      {children}
    </ProjectDrillDownShell>
  );
}
