import { redirect } from "next/navigation";

export default async function IndividualProjectAiDesignerRedirect({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
}) {
  const { clientId, projectId } = await params;
  redirect(`/ai-designer?folder=${clientId}&project=${projectId}`);
}
