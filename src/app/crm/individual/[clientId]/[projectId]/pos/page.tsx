import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Legacy drill-down tab — the Purchase Orders list now lives in the
 * unified project panel on the client page (same view companies use).
 */
export default async function IndividualProjectPosTab({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
}) {
  const { clientId, projectId } = await params;
  redirect(`/crm/individual/${clientId}?project=${projectId}&tab=pos`);
}
