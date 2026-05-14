import ProjectQuotationsTabSection from "@/components/ProjectQuotationsTabSection";

export const dynamic = "force-dynamic";

export default async function IndividualProjectQuotationsTab({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
}) {
  const { clientId, projectId } = await params;
  const base = `/crm/individual/${clientId}/${projectId}`;
  return (
    <ProjectQuotationsTabSection
      projectId={Number(projectId)}
      base={base}
    />
  );
}
