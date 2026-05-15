import ProjectBoqsTabSection from "@/components/ProjectBoqsTabSection";

export const dynamic = "force-dynamic";

export default async function IndividualProjectBoqsTab({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
}) {
  const { clientId, projectId } = await params;
  return (
    <ProjectBoqsTabSection
      projectId={Number(projectId)}
      folderId={Number(clientId)}
    />
  );
}
