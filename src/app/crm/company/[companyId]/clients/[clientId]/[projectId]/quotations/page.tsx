import ProjectQuotationsTabSection from "@/components/ProjectQuotationsTabSection";

export const dynamic = "force-dynamic";

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
  const base = `/crm/company/${companyId}/clients/${clientId}/${projectId}`;
  return (
    <ProjectQuotationsTabSection
      projectId={Number(projectId)}
      base={base}
    />
  );
}
