import { redirect } from "next/navigation";

export default async function CompanyProjectCatalogueRedirect({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
}) {
  const { clientId, projectId } = await params;
  redirect(`/catalog?folder=${clientId}&project=${projectId}`);
}
