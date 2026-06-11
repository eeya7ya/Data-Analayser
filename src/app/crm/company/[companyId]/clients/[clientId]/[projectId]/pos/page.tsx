import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Legacy drill-down tab — the Purchase Orders list now lives in the
 * unified project panel on the client page.
 */
export default async function CompanyProjectPosTab({
  params,
}: {
  params: Promise<{ companyId: string; clientId: string; projectId: string }>;
}) {
  const { companyId, clientId, projectId } = await params;
  redirect(
    `/crm/company/${companyId}/clients/${clientId}?project=${projectId}&tab=pos`,
  );
}
