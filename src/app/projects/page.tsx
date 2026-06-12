import Link from "next/link";
import { redirect } from "next/navigation";
import { sql, ensureSchema } from "@/lib/db";
import { getSessionUser, canReadAll } from "@/lib/auth";
import { getVisibleProjectIds } from "@/lib/scope";
import { hasModule } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import ExecutionReportsSummary from "@/components/ExecutionReportsSummary";

export const dynamic = "force-dynamic";

/**
 * Projects-module landing page.
 *
 * Visible rows = visibility scope from getScope() ∪ projects the user
 * owns directly. Admins see everything. Each row links to its detail
 * page where engineers/technicals can be assigned. The page renders
 * an empty-state explainer for users without any visibility so they
 * understand the page is gated rather than broken.
 */

interface ProjectListRow {
  id: number;
  name: string;
  description: string | null;
  status: string;
  folder_id: number;
  folder_name: string | null;
  owner_username: string | null;
  assignment_count: number;
  quotation_count: number;
  my_assignment_role: string | null;
}

export default async function ProjectsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  await ensureSchema();

  const isAdmin = canReadAll(user);
  const hasProjectsModule = isAdmin || (await hasModule(user.id, "projects"));
  const hasCrmModule = isAdmin || (await hasModule(user.id, "crm"));

  // Compose the visibility set. Projects-module users see their
  // assignments + projects owned by anyone in teams they manage; CRM
  // users (no projects role) fall through to "projects I own". Both
  // sets are merged so a sales engineer who is also a technical on
  // someone else's project sees both rows.
  const visibility = hasProjectsModule
    ? await getVisibleProjectIds(user, "projects")
    : { allAccess: false, ids: [] as number[] };

  let rows: ProjectListRow[] = [];

  const q = sql();
  if (visibility.allAccess || isAdmin) {
    rows = (await q`
      select p.id, p.name, p.description, p.status, p.folder_id,
             cf.name as folder_name,
             u.username as owner_username,
             (select count(*) from project_assignments pa
                where pa.project_id = p.id and pa.deleted_at is null) as assignment_count,
             (select count(*) from quotations qq
                where qq.project_id = p.id and qq.deleted_at is null) as quotation_count,
             (select role from project_assignments pa
                where pa.project_id = p.id
                  and pa.user_id = ${user.id}
                  and pa.deleted_at is null
                limit 1) as my_assignment_role
      from projects p
      left join client_folders cf on cf.id = p.folder_id
      left join users u on u.id = p.owner_id
      where p.deleted_at is null
      order by p.id desc
      limit 500
    `) as ProjectListRow[];
  } else {
    // Visible via scope (assignments + team-member-owned) UNION
    // projects I own directly (covers CRM users whose own projects
    // should still appear here regardless of projects-module access).
    rows = (await q`
      select p.id, p.name, p.description, p.status, p.folder_id,
             cf.name as folder_name,
             u.username as owner_username,
             (select count(*) from project_assignments pa
                where pa.project_id = p.id and pa.deleted_at is null) as assignment_count,
             (select count(*) from quotations qq
                where qq.project_id = p.id and qq.deleted_at is null) as quotation_count,
             (select role from project_assignments pa
                where pa.project_id = p.id
                  and pa.user_id = ${user.id}
                  and pa.deleted_at is null
                limit 1) as my_assignment_role
      from projects p
      left join client_folders cf on cf.id = p.folder_id
      left join users u on u.id = p.owner_id
      where p.deleted_at is null
        and (
          p.id = any(${visibility.ids})
          or p.owner_id = ${user.id}
        )
      order by p.id desc
      limit 500
    `) as ProjectListRow[];
  }

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-6xl mx-auto px-6 py-6 lg:px-10">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-magic-ink">Projects</h1>
            <p className="text-sm text-magic-ink/60 mt-0.5">
              {rows.length} {rows.length === 1 ? "project" : "projects"} visible
              to you
              {hasProjectsModule && !hasCrmModule && " · projects module"}
              {hasCrmModule && !hasProjectsModule && " · own + folder projects"}
              {hasProjectsModule && hasCrmModule && " · combined access"}
            </p>
          </div>
        </div>

        {rows.length > 0 && (
          <div className="mb-6">
            <ExecutionReportsSummary />
          </div>
        )}

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-magic-border bg-white p-8 text-center">
            <p className="text-magic-ink/70 mb-2">No projects visible yet.</p>
            <p className="text-sm text-magic-ink/50">
              {hasProjectsModule
                ? "An admin or project manager hasn't assigned you to any project. Once they do, the project will appear here."
                : "You don't have access to the Projects module. Ask an admin in the Modules tab to grant you projects.engineer, projects.technical, or projects.manager."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((p) => (
              <li
                key={p.id}
                className="rounded-xl border border-magic-border bg-white p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <Link
                      href={`/projects/${p.id}`}
                      className="font-semibold text-magic-ink hover:text-magic-red"
                    >
                      {p.name}
                    </Link>
                    {p.folder_name && (
                      <span className="ml-2 text-xs text-magic-ink/50">
                        in {p.folder_name}
                      </span>
                    )}
                    {p.description && (
                      <p className="text-sm text-magic-ink/60 mt-0.5 line-clamp-2">
                        {p.description}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                      <StatusPill status={p.status} />
                      {p.my_assignment_role && (
                        <span className="inline-flex items-center rounded-full border border-indigo-300 bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">
                          You: {p.my_assignment_role}
                        </span>
                      )}
                      <span className="text-magic-ink/40">
                        {p.assignment_count} assigned · {p.quotation_count}{" "}
                        quotations
                        {p.owner_username && (
                          <> · owner @{p.owner_username}</>
                        )}
                      </span>
                    </div>
                  </div>
                  <Link
                    href={`/projects/${p.id}`}
                    className="shrink-0 rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft"
                  >
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "done" || status === "closed"
      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
      : status === "blocked" || status === "hold"
        ? "border-amber-300 bg-amber-50 text-amber-700"
        : "border-magic-border bg-magic-soft/50 text-magic-ink/70";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${tone}`}>
      {status}
    </span>
  );
}
