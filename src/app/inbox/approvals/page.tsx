import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Deprecated. There is no sales-manager approval step any more — sales drive
 * the entire quotation lifecycle (review, client outcome, hand-off) from the
 * Quote-to-Delivery pipeline, and nothing ever set `approved_at`, so this
 * inbox listed every live quotation forever and its "Approve / Reject" buttons
 * no longer exist on the viewer. The route is kept only so old bookmarks /
 * notification links land somewhere sensible: the pipeline.
 */
export default function ApprovalsInboxPage() {
  redirect("/crm/pipeline");
}
