import ProjectQuotationsTabSection from "@/components/ProjectQuotationsTabSection";

export const dynamic = "force-dynamic";

export default async function LegacyProjectQuotationsTab({
  params,
}: {
  params: Promise<{ kind: string; clientId: string; projectId: string }>;
}) {
  const { kind, clientId, projectId } = await params;
  const projId = Number(projectId);
  const base = `/crm/${kind}/${clientId}/${projectId}`;
  return <ProjectQuotationsTabSection projectId={projId} base={base} />;
}
