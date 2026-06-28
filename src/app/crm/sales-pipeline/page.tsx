import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The standalone Held / Won / Lost board has been folded into the full
 * Quote-to-Delivery pipeline (`/crm/pipeline`). This route is kept only so old
 * links, bookmarks and notifications still resolve — it redirects.
 */
export default function SalesPipelineRedirect() {
  redirect("/crm/pipeline");
}
