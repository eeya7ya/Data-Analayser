import Link from "next/link";
import { sql } from "@/lib/db";
import { getSessionUser, canReadAll } from "@/lib/auth";
import { hasModule } from "@/lib/modules";
import ProjectBoqsList, {
  type ProjectFileRow,
} from "@/components/ProjectBoqsList";

/**
 * Server-rendered BOQs / Files panel for a project.
 *
 * Visibility mirrors /api/project-files:
 *   - admin / project owner / folder owner → every file, with the share
 *     toggle (so sales / presales can mark a BOQ readable by projects).
 *   - projects-module user / assigned member → only files flagged
 *     `shared_to_projects`, read-only. This is what a project manager
 *     sees for a project pushed to them.
 *   - anyone else → nothing.
 */
export default async function ProjectBoqsTabSection({
  projectId,
  folderId,
}: {
  projectId: number;
  folderId: number;
}) {
  const user = await getSessionUser();
  const q = sql();

  const projRows = (await q`
    select p.owner_id, cf.owner_id as folder_owner_id
    from projects p
    join client_folders cf on cf.id = p.folder_id
    where p.id = ${projectId}
    limit 1
  `) as Array<{ owner_id: number | null; folder_owner_id: number | null }>;
  const proj = projRows[0];

  let tier: "full" | "shared" | null = null;
  if (user && proj) {
    if (
      canReadAll(user) ||
      proj.owner_id === user.id ||
      proj.folder_owner_id === user.id
    ) {
      tier = "full";
    } else if (await hasModule(user.id, "projects")) {
      tier = "shared";
    } else {
      const assigned = (await q`
        select 1 from project_assignments
        where project_id = ${projectId} and user_id = ${user.id}
          and deleted_at is null
        limit 1
      `) as Array<{ "?column?": number }>;
      if (assigned.length > 0) tier = "shared";
    }
  }

  const sharedOnly = tier === "shared";
  const rows =
    tier === null
      ? []
      : ((await q`
          select id, project_id, kind, filename, mime, size_bytes,
                 storage_path, shared_to_projects, created_at
          from project_files
          where project_id = ${projectId}
            and deleted_at is null
            and (${sharedOnly}::boolean = false or shared_to_projects = true)
          order by created_at desc
          limit 500
        `) as ProjectFileRow[]);

  const canShare = tier === "full";

  return (
    <section className="rounded-2xl border border-magic-border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-semibold text-magic-ink">
            BOQs / Files
            <span className="ml-2 text-xs font-normal text-magic-ink/60">
              ({rows.length})
            </span>
          </h2>
          <p className="text-xs text-magic-ink/60">
            {sharedOnly
              ? "Files the sales / presales team shared with projects for this job."
              : "Files uploaded under this project. Use “Share to projects” on a BOQ to let the projects team read it."}
          </p>
        </div>
        {tier === "full" && (
          <Link
            href={`/folder/${folderId}`}
            className="rounded-lg border border-magic-red text-magic-red px-3 py-1.5 text-xs font-semibold hover:bg-magic-red hover:text-white transition-colors"
          >
            Upload files (legacy folder view) →
          </Link>
        )}
      </div>

      <ProjectBoqsList rows={rows} canShare={canShare} />
    </section>
  );
}
