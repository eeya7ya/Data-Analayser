import { redirect } from "next/navigation";

export default async function IndividualProjectNewQuotationRedirect({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
}) {
  const { clientId, projectId } = await params;
  redirect(`/designer?folder=${clientId}&project=${projectId}&new=1`);
}
