import ContactDetail from "@/components/crm/ContactDetail";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ContactDetail id={Number(id)} />;
}
