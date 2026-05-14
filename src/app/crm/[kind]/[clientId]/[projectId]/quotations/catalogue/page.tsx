import { redirect } from "next/navigation";

/**
 * Catalogue browser inside a project's quotations tab. Catalogue
 * itself doesn't need project context to render, but we pass it
 * through as a query string so a future enhancement (e.g. "add
 * selected items to a new quotation in this project") has the data
 * it needs.
 */
export default async function CatalogueRedirectPage({
  params,
}: {
  params: Promise<{ clientId: string; projectId: string }>;
}) {
  const { clientId, projectId } = await params;
  redirect(`/catalog?folder=${clientId}&project=${projectId}`);
}
