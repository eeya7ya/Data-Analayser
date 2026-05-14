import { redirect } from "next/navigation";

/**
 * AI Designer entry point inside a project. Hands off to the existing
 * /ai-designer page with the folder + project context so the produced
 * quotation lands under the right project from the start.
 */
export default async function AiDesignerRedirectPage({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
}) {
  const { clientId, projectId } = await params;
  redirect(`/ai-designer?folder=${clientId}&project=${projectId}`);
}
