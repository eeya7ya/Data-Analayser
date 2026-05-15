import ProjectPosTabSection from "@/components/ProjectPosTabSection";

export const dynamic = "force-dynamic";

export default async function IndividualProjectPosTab({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectPosTabSection projectId={Number(projectId)} />;
}
