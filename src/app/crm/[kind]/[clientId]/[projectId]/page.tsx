import { redirect } from "next/navigation";

// Default tab is Quotations. The layout already handles access checks
// and the breadcrumb, so the root just bounces into /quotations.
export default async function ProjectRootPage({
  params,
}: {
  params: Promise<{ kind: string; clientId: string; projectId: string }>;
}) {
  const { kind, clientId, projectId } = await params;
  redirect(`/crm/${kind}/${clientId}/${projectId}/quotations`);
}
