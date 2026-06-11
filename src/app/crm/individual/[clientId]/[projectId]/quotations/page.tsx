import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Legacy drill-down tab. The per-project Quotations list now lives in
 * the unified project panel on the client page, so deep links (RFQ
 * notifications, search hits, old bookmarks) land on the same view
 * companies use. Deeper routes (/quotations/[qId], /new, /ai,
 * /catalogue) are untouched — only this index redirects.
 */
export default async function IndividualProjectQuotationsTab({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
}) {
  const { clientId, projectId } = await params;
  redirect(`/crm/individual/${clientId}?project=${projectId}&tab=quotations`);
}
