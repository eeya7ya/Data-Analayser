import { redirect } from "next/navigation";

export default async function CompanyProjectRoot({
  params,
}: {
  params: Promise<{ companyId: string; clientId: string; projectId: string }>;
}) {
  const { companyId, clientId, projectId } = await params;
  redirect(`/crm/company/${companyId}/clients/${clientId}/${projectId}/quotations`);
}
