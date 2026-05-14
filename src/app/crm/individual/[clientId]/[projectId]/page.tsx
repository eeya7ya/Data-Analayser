import { redirect } from "next/navigation";

export default async function IndividualProjectRoot({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
}) {
  const { clientId, projectId } = await params;
  redirect(`/crm/individual/${clientId}/${projectId}/quotations`);
}
