import Link from "next/link";
import { sql } from "@/lib/db";
import ProjectBoqsList, {
  type ProjectFileRow,
} from "@/components/ProjectBoqsList";

export default async function ProjectBoqsTabSection({
  projectId,
  folderId,
}: {
  projectId: number;
  /**
   * The folder the project lives under. Used only to link the
   * "Upload via legacy folder view" affordance until the new BOQ
   * uploader lands. Passing it here keeps the section reusable
   * across drill-down paths that resolve folderId from different
   * URL segments.
   */
  folderId: number;
}) {
  const q = sql();
  const rows = (await q`
    select id, project_id, kind, filename, mime, size_bytes, storage_path, created_at
    from project_files
    where project_id = ${projectId}
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
          href={`/folder/${folderId}`}
          className="rounded-lg border border-magic-red text-magic-red px-3 py-1.5 text-xs font-semibold hover:bg-magic-red hover:text-white transition-colors"
        >
          Upload files (legacy folder view) →
        </Link>
      </div>

      <ProjectBoqsList rows={rows} />
    </section>
  );
}
