import { redirect } from "next/navigation";

/**
 * Editing an existing quotation from within the project drill-down.
 * Hops to the legacy /designer page with the id. Project context
 * stays in the URL via the back-button on Designer (the user can
 * return to the project tab to see the saved quotation).
 */
export default async function EditQuotationRedirectPage({
  params,
}: {
  params: Promise<{ qId: string }>;
}) {
  const { qId } = await params;
  redirect(`/designer?id=${qId}`);
}
