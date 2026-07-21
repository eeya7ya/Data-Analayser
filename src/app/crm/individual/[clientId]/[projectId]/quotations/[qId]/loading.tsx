import PageLoader from "@/components/PageLoader";

/**
 * Content-area fallback: the project shell (TopBar, breadcrumb, tab strip)
 * is rendered by the [projectId] layout above and stays mounted during tab
 * navigation, so only the section body shows the loader.
 */
export default function IndividualQuotationLoading() {
  return <PageLoader label="Loading quotation…" />;
}
