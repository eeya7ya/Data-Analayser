import { redirect } from "next/navigation";

/**
 * Authoring a new quotation inside a project context. We pass the
 * client folder + project IDs through to the legacy /designer page,
 * which already knows how to compose a fresh quotation under a folder
 * and accept the optional `project=` hint. Nothing in /designer or
 * its data flow is touched.
 */
export default async function NewQuotationRedirectPage({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
}) {
  const { clientId, projectId } = await params;
  redirect(`/designer?folder=${clientId}&project=${projectId}&new=1`);
}
