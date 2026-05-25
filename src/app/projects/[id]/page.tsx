import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql, ensureSchema } from "@/lib/db";
import { getSessionUser, canReadAll } from "@/lib/auth";
import { hasModule, hasModuleRole } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import ProjectAssignmentsPanel from "@/components/ProjectAssignmentsPanel";
import ProjectBoqsTabSection from "@/components/ProjectBoqsTabSection";
import ExecutionReportsPanel from "@/components/ExecutionReportsPanel";
import RequestStockButton from "@/components/RequestStockButton";

export const dynamic = "force-dynamic";

interface ProjectDetail {
  id: number;
  name: string;
  description: string | null;
  status: string;
  folder_id: number;
  folder_name: string | null;
  owner_id: number | null;
  owner_username: string | null;
  created_at: string;
  updated_at: string;
}

interface QuotationLite {
  id: number;
  ref: string;
  project_name: string;
  status: string;
  approved_at: string | null;
  rejected_at: string | null;
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");

  await ensureSchema();

  const q = sql();
  const rows = (await q`
    select p.id, p.name, p.description, p.status, p.folder_id,
           cf.name as folder_name,
           p.owner_id, u.username as owner_username,
           p.created_at, p.updated_at
    from projects p
    left join client_folders cf on cf.id = p.folder_id
    left join users u on u.id = p.owner_id
    where p.id = ${id} and p.deleted_at is null
    limit 1
  `) as ProjectDetail[];

  if (rows.length === 0) notFound();
  const project = rows[0];

  // Visibility check: admin, owner, projects-module user (any role),
  // or someone with an active assignment on this project.
  const isAdmin = canReadAll(user);
  const isOwner = project.owner_id === user.id;
  let canView = isAdmin || isOwner;
  if (!canView && (await hasModule(user.id, "projects"))) canView = true;
  if (!canView) {
    const assigned = (await q`
      select 1 from project_assignments
      where project_id = ${id} and user_id = ${user.id} and deleted_at is null
      limit 1
    `) as Array<{ "?column?": number }>;
    canView = assigned.length > 0;
  }
  if (!canView) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="max-w-3xl mx-auto px-6 py-10 text-center">
          <h1 className="text-xl font-bold text-magic-ink mb-2">
            You don&apos;t have access to this project
          </h1>
          <p className="text-sm text-magic-ink/60">
            Ask the project owner or an admin to assign you. Your existing
            grants and data remain untouched.
          </p>
          <Link
            href="/projects"
            className="inline-block mt-4 rounded-lg border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft"
          >
            Back to projects
          </Link>
        </main>
      </div>
    );
  }

  const canManage =
    isAdmin || isOwner || (await hasModuleRole(user.id, "projects", "manager"));

  const quotations = (await q`
    select id, ref, project_name, status, approved_at, rejected_at
    from quotations
    where project_id = ${id} and deleted_at is null
    order by id desc
    limit 100
  `) as QuotationLite[];

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-5xl mx-auto px-6 py-6 lg:px-10 space-y-5">
        <div>
          <Link
            href="/projects"
            className="text-xs text-magic-ink/50 hover:text-magic-red"
          >
            ← All projects
          </Link>
          <div className="flex items-start justify-between gap-3 mt-1">
            <h1 className="text-2xl font-bold text-magic-ink">
              {project.name}
            </h1>
            <RequestStockButton projectId={id} />
          </div>
          <div className="mt-1 text-sm text-magic-ink/60 flex flex-wrap items-center gap-2">
            <span>Status: {project.status}</span>
            {project.folder_name && (
              <>
                <span>·</span>
                <Link
                  href={`/folder/${project.folder_id}`}
                  className="hover:text-magic-red"
                >
                  Folder: {project.folder_name}
                </Link>
              </>
            )}
            {project.owner_username && (
              <>
                <span>·</span>
                <span>Owner: @{project.owner_username}</span>
              </>
            )}
          </div>
          {project.description && (
            <p className="mt-3 text-sm text-magic-ink/80 whitespace-pre-line">
              {project.description}
            </p>
          )}
        </div>

        <ProjectAssignmentsPanel projectId={id} canManage={canManage} />

        {/* BOQs / files. Access-aware: full for owner/admin (with the
            share toggle), shared-only and read-only for assigned
            projects-module members. */}
        <ProjectBoqsTabSection projectId={id} folderId={project.folder_id} />

        {/* Execution reports — assigned technicians / engineers post
            progress + feedback; the PM and owner read them. */}
        <ExecutionReportsPanel projectId={id} />

        {(isAdmin || isOwner) && (
        <section className="rounded-2xl border border-magic-border bg-white p-5">
          <h2 className="text-lg font-semibold text-magic-ink mb-3">
            Quotations under this project
          </h2>
          {quotations.length === 0 ? (
            <p className="text-sm text-magic-ink/50 italic">
              No quotations filed under this project yet.
            </p>
          ) : (
            <ul className="divide-y divide-magic-border">
              {quotations.map((qq) => (
                <li
                  key={qq.id}
                  className="py-2 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/quotation?id=${qq.id}`}
                      className="font-mono text-sm font-semibold text-magic-ink hover:text-magic-red"
                    >
                      {qq.ref}
                    </Link>
                    <span className="ml-2 text-sm text-magic-ink/70">
                      {qq.project_name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-magic-ink/50">{qq.status}</span>
                    {qq.approved_at && (
                      <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                        approved
                      </span>
                    )}
                    {qq.rejected_at && (
                      <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                        rejected
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        )}
      </main>
    </div>
  );
}
