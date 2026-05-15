import { notFound, redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import QuotationViewer from "@/components/QuotationViewer";

/**
 * Verifies a quotation belongs to the given project, then renders
 * the existing QuotationViewer inside the drill-down shell. If the
 * quotation moved projects, we hand off to the legacy viewer rather
 * than 404 so the URL still resolves to the correct document.
 */
export default async function ProjectQuotationViewerSection({
  projectId,
  quotationId,
}: {
  projectId: number;
  quotationId: number;
}) {
  if (!Number.isFinite(projectId) || !Number.isFinite(quotationId)) {
    notFound();
  }

  const q = sql();
  const rows = (await q`
    select id, project_id from quotations
    where id = ${quotationId} and deleted_at is null
    limit 1
  `) as Array<{ id: number; project_id: number | null }>;
  if (rows.length === 0) notFound();
  if (rows[0].project_id !== projectId) {
    redirect(`/quotation?id=${quotationId}`);
  }

  const appSettings = await getAppSettings();
  return (
    <section className="rounded-2xl border border-magic-border bg-white p-5">
      <QuotationViewer quotationId={quotationId} appSettings={appSettings} />
    </section>
  );
}
