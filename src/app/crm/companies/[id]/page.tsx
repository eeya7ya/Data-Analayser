import CompanyDetail from "@/components/crm/CompanyDetail";

export const dynamic = "force-dynamic";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CompanyDetail id={Number(id)} />;
}
