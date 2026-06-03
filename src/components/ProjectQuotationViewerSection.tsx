import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import QuotationViewer from "@/components/QuotationViewer";

/**
 * Verifies a quotation exists, then renders the existing QuotationViewer
 * inside the drill-down shell. We intentionally do NOT bounce a quotation
 * whose project moved back to `/quotation?id=` — that route is now a thin
 * compatibility shim that forwards id-only links straight back into this CRM
 * viewer, so redirecting to it would loop. Rendering the viewer here for any
 * existing quotation is safe: the viewer's own `/api/quotations` fetch still
 * enforces per-user access.
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
    select id from quotations
    where id = ${quotationId} and deleted_at is null
    limit 1
  `) as Array<{ id: number }>;
  if (rows.length === 0) notFound();

  const appSettings = await getAppSettings();
  return (
    <section className="rounded-2xl border border-magic-border bg-white p-5">
      <QuotationViewer quotationId={quotationId} appSettings={appSettings} />
    </section>
  );
}
