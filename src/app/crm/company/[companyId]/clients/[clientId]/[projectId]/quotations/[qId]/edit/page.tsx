import { redirect } from "next/navigation";

export default async function CompanyProjectQuotationEditRedirect({
  params,
}: {
  params: Promise<{ qId: string }>;
}) {
  const { qId } = await params;
  redirect(`/designer?id=${qId}`);
}
