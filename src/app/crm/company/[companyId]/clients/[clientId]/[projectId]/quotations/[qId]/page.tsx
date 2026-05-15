import ProjectQuotationViewerSection from "@/components/ProjectQuotationViewerSection";

export const dynamic = "force-dynamic";

export default async function CompanyProjectQuotationViewer({
  params,
}: {
  params: Promise<{ projectId: string; qId: string }>;
}) {
  const { projectId, qId } = await params;
  return (
    <ProjectQuotationViewerSection
      projectId={Number(projectId)}
      quotationId={Number(qId)}
    />
  );
}
