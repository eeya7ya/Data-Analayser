import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * BOQs / Files tab. Lists every project_files row scoped to this
 * project, grouped by `kind` (quotation / po / boq / other). Upload
 * still happens via the legacy folder view for now — the link below
 * sends you there. Nothing is deleted from this tab.
 */

interface FileRow {
  id: number;
  project_id: number;
  kind: string;
  filename: string;
  mime: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
}

const KIND_LABELS: Record<string, string> = {
  boq: "BOQs",
  quotation: "Quotation files",
  po: "PO files",
  other: "Other files",
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

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
  `) as FileRow[];

  const groups = new Map<string, FileRow[]>();
  // Surface BOQ first so the tab matches its name; then quotation, po, other.
  for (const k of ["boq", "quotation", "po", "other"]) {
    groups.set(k, []);
  }
  for (const f of rows) {
    const k = KIND_LABELS[f.kind] ? f.kind : "other";
    groups.get(k)?.push(f);
  }

  return (
    <section className="rounded-2xl border border-magic-border bg-white p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
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

      {rows.length === 0 ? (
        <p className="text-sm text-magic-ink/50 italic">
          No files uploaded under this project yet. Use the legacy folder
          view to attach BOQs / quotation PDFs / PO scans / other.
        </p>
      ) : (
        Array.from(groups.entries())
          .filter(([, list]) => list.length > 0)
          .map(([kindKey, list]) => (
            <div key={kindKey}>
              <h3 className="text-sm font-semibold text-magic-ink mb-1.5">
                {KIND_LABELS[kindKey] ?? kindKey}
                <span className="ml-2 text-xs font-normal text-magic-ink/60">
                  ({list.length})
                </span>
              </h3>
              <ul className="divide-y divide-magic-border/60 rounded-lg border border-magic-border overflow-hidden">
                {list.map((f) => (
                  <li
                    key={f.id}
                    className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-magic-soft/40"
                  >
                    <div className="min-w-0">
                      <a
                        href={`/api/project-files/${f.id}`}
                        className="text-sm text-magic-red hover:underline truncate"
                      >
                        {f.filename}
                      </a>
                      <div className="text-xs text-magic-ink/50 mt-0.5">
                        {f.mime} · {humanSize(Number(f.size_bytes))} ·
                        uploaded {new Date(f.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))
      )}
    </section>
  );
}
