import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import RequestStockButton from "@/components/RequestStockButton";
import ProjectTabStrip from "@/components/ProjectTabStrip";

export const dynamic = "force-dynamic";

/**
 * Shared layout for everything under a project in the CRM drill-down.
 *
 *   /crm/[kind]/[clientId]/[projectId]                  → default tab (quotations)
 *   /crm/[kind]/[clientId]/[projectId]/quotations
 *   /crm/[kind]/[clientId]/[projectId]/pos
 *   /crm/[kind]/[clientId]/[projectId]/boqs
 *
 * The layout owns the breadcrumb, the project header, the tab strip,
 * and the access check. Each tab page renders below as `children` and
 * only worries about its own list. The "Request stock" button lives
 * here so it's available no matter which tab is active.
 *
 * Access: admin, project owner, folder owner, projects.* user, or a
 * user with an active assignment on this project. Everything else
 * sees an explanatory page (not a hard 403) with a link back to /crm.
 */
export default async function ProjectLayout({
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
  if (!Number.isFinite(folderId) || !Number.isFinite(projId)) notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const q = sql();
  const rows = (await q`
    select p.id, p.folder_id, p.owner_id, p.name, p.description, p.status,
           cf.name as folder_name, cf.kind as folder_kind, cf.owner_id as folder_owner
    from projects p
    join client_folders cf on cf.id = p.folder_id
    where p.id = ${projId} and p.deleted_at is null and cf.deleted_at is null
    limit 1
  `) as Array<{
    id: number;
    folder_id: number;
    owner_id: number | null;
    name: string;
    description: string | null;
    status: string;
    folder_name: string;
    folder_kind: "company" | "individual" | null;
    folder_owner: number | null;
  }>;
  if (rows.length === 0 || rows[0].folder_id !== folderId) notFound();
  const project = rows[0];

  // If the folder got re-classified after the URL was bookmarked,
  // redirect to the correct kind. Same pattern as the client page.
  const actualKindUrl = project.folder_kind ?? "unclassified";
  if (actualKindUrl !== kind) {
    redirect(`/crm/${actualKindUrl}/${folderId}/${projId}`);
  }

  // Access check: admin / project owner / folder owner gets through
  // automatically. Anyone else needs either projects-module access or
  // an active assignment on this project.
  const isAdmin = user.role === "admin";
  let canView =
    isAdmin || project.owner_id === user.id || project.folder_owner === user.id;
  if (!canView) {
    const hasProjects = (await q`
      select 1 from user_module_roles
      where user_id = ${user.id} and module = 'projects' and revoked_at is null
      limit 1
    `) as Array<{ "?column?": number }>;
    if (hasProjects.length > 0) canView = true;
  }
  if (!canView) {
    const assigned = (await q`
      select 1 from project_assignments
      where project_id = ${projId} and user_id = ${user.id} and deleted_at is null
      limit 1
    `) as Array<{ "?column?": number }>;
    if (assigned.length > 0) canView = true;
  }
  if (!canView) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="max-w-3xl mx-auto p-6 text-center">
          <h1 className="text-xl font-bold text-magic-ink mb-2">
            You don&apos;t have access to this project
          </h1>
          <p className="text-sm text-magic-ink/60">
            Ask the owner to assign you, or an admin to grant projects-module
            access. The project and every file under it stay intact regardless
            of access changes.
          </p>
          <Link
            href="/crm"
            className="inline-block mt-4 rounded-lg border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft transition-colors"
          >
            ← Back to CRM
          </Link>
        </main>
      </div>
    );
  }

  const base = `/crm/${kind}/${folderId}/${projId}`;

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-6xl mx-auto px-6 py-6 lg:px-10 space-y-5">
        <div>
          <div className="text-xs text-magic-ink/50">
            <Link href="/" className="hover:text-magic-red">
              Dashboard
            </Link>{" "}
            <span>→</span>{" "}
            <Link href="/crm" className="hover:text-magic-red">
              CRM
            </Link>{" "}
            <span>→</span>{" "}
            <Link href={`/crm/${kind}`} className="hover:text-magic-red">
              {kind}
            </Link>{" "}
            <span>→</span>{" "}
            <Link
              href={`/crm/${kind}/${folderId}`}
              className="hover:text-magic-red"
            >
              {project.folder_name}
            </Link>
          </div>
          <div className="flex items-start justify-between gap-3 mt-1">
            <div>
              <h1 className="text-2xl font-bold text-magic-ink">
                {project.name}
              </h1>
              <div className="text-xs text-magic-ink/60 mt-0.5">
                status: {project.status}
              </div>
              {project.description && (
                <p className="text-sm text-magic-ink/80 mt-2 whitespace-pre-line">
                  {project.description}
                </p>
              )}
            </div>
            <RequestStockButton projectId={projId} />
          </div>
        </div>

        <ProjectTabStrip base={base} />

        {children}
      </main>
    </div>
  );
}
