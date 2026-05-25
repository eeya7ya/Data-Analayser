import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The standalone lead inbox was folded into the main leads list ("Waiting
 * on me" tab), so a presales user has a single lead surface instead of two
 * nested pages. This route now just redirects to /leads.
 */
export default function LeadInboxPage() {
  redirect("/leads");
}
