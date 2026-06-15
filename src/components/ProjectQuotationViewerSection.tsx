import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import QuotationViewer from "@/components/QuotationViewer";
import BackButton from "@/components/BackButton";

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
  // This viewer renders as a standalone full-screen page (no TopBar chrome),
  // so it carries its own back control — otherwise there's no way out of a
  // successfully-loaded quotation except the browser button.
  return (
    <div className="mx-auto max-w-screen-xl px-4 py-4 sm:px-6">
      {/* `no-print` so the back link is stripped from the printed PDF. The
          surrounding ProjectDrillDownShell supplies `print-root`/`print-main`,
          which force every non-`.no-print` element inside the print area to
          `display: block` — without this class the "← Back" link rendered at
          the top of page 1 and pushed the full-bleed cover sheet off the
          first page, exactly the broken view-page print the designer's
          (already `no-print`-wrapped) back button never had. */}
      <div className="no-print mb-3">
        <BackButton fallbackHref="/crm" fallbackLabel="Back" />
      </div>
      <section className="rounded-2xl border border-magic-border bg-white p-5">
        <QuotationViewer quotationId={quotationId} appSettings={appSettings} />
      </section>
    </div>
  );
}
