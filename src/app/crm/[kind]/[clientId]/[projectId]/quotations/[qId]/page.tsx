import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import QuotationViewer from "@/components/QuotationViewer";

export const dynamic = "force-dynamic";

/**
 * Quotation viewer inside the project drill-down. The shared layout
 * a level up already enforces access on the project; we only verify
 * the quotation actually belongs to this project, then render the
 * existing QuotationViewer component. The legacy /quotation?id=N
 * viewer is preserved for any pre-V2 bookmark.
 */
export default async function ProjectQuotationViewerPage({
  params,
}: {
  params: Promise<{
    kind: string;
    clientId: string;
    projectId: string;
    qId: string;
  }>;
}) {
  const { projectId, qId } = await params;
  const projId = Number(projectId);
  const quotationId = Number(qId);
  if (!Number.isFinite(projId) || !Number.isFinite(quotationId)) notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const q = sql();
  const rows = (await q`
    select id, project_id from quotations
    where id = ${quotationId} and deleted_at is null
    limit 1
  `) as Array<{ id: number; project_id: number | null }>;
  if (rows.length === 0) notFound();
  if (rows[0].project_id !== projId) {
    // The quotation moved projects. Send the user to the correct URL
    // rather than 404 — bookmarks stay stable for at least one hop.
    // The new path is reachable through the legacy viewer too.
    redirect(`/quotation?id=${quotationId}`);
  }

  const appSettings = await getAppSettings();

  return (
    <section className="rounded-2xl border border-magic-border bg-white p-5">
      <QuotationViewer
        quotationId={quotationId}
        appSettings={appSettings}
      />
    </section>
  );
}
