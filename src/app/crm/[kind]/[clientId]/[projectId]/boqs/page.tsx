import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import ProjectBoqsList, {
  type ProjectFileRow,
} from "@/components/ProjectBoqsList";

export const dynamic = "force-dynamic";

/**
 * BOQs / Files tab. Lists every project_files row scoped to this
 * project. Grouping and search live in the client component so the
 * filter box on top of the page works without a round-trip per
 * keystroke. Upload still happens via the legacy folder view —
 * linked in the header.
 */
export default async function ProjectBoqsTabPage({
  params,
}: {
  params: Promise<{ kind: string; clientId: string; projectId: string }>;
}) {
  const { clientId, projectId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const projId = Number(projectId);
  const q = sql();
  const rows = (await q`
    select id, project_id, kind, filename, mime, size_bytes, storage_path, created_at
    from project_files
    where project_id = ${projId}
      and deleted_at is null
    order by created_at desc
    limit 500
  `) as ProjectFileRow[];

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
            Files uploaded under this project. BOQ documents sit at the
            top; everything else (quotation PDFs, PO scans, ad-hoc
            attachments) appears below.
          </p>
        </div>
        <Link
          href={`/folder/${clientId}`}
          className="rounded-lg border border-magic-red text-magic-red px-3 py-1.5 text-xs font-semibold hover:bg-magic-red hover:text-white transition-colors"
        >
          Upload files (legacy folder view) →
        </Link>
      </div>

      <ProjectBoqsList rows={rows} />
    </section>
  );
}
