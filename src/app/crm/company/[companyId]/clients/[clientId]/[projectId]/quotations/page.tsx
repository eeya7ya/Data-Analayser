import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Legacy drill-down tab. The per-project Quotations list now lives in
 * the unified project panel on the client page. Deeper routes
 * (/quotations/[qId], /new, /ai, /catalogue) are untouched — only this
 * index redirects.
 */
export default async function CompanyProjectQuotationsTab({
  params,
}: {
  params: Promise<{
    companyId: string;
    clientId: string;
    projectId: string;
  }>;
}) {
  const { companyId, clientId, projectId } = await params;
  redirect(
    `/crm/company/${companyId}/clients/${clientId}?project=${projectId}&tab=quotations`,
  );
}
