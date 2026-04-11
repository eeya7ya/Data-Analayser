"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import QuotationListClient from "@/components/QuotationListClient";
import TrashView from "@/components/TrashView";

/**
 * Small tab switcher on the /quotation page so the Saved Quotations list
 * and the Trash bin can share the same route instead of forcing the user
 * to navigate to a separate page. The initial data arrives from the
 * server page so the list renders with real rows on first paint instead
 * of flashing skeletons.
 *
 * The selected tab lives in the URL (`?tab=trash`) so the browser back
 * button restores the previous tab and users can bookmark / link to the
 * trash view. We use `router.replace` (not `push`) because rapidly
 * flipping between tabs should not stuff history with dozens of entries.
 */
export default function QuotationsPageTabs({
  isAdmin,
  initialQuotations,
  initialFolders,
}: {
  isAdmin: boolean;
  initialQuotations?: Array<Record<string, unknown>>;
  initialFolders?: Array<Record<string, unknown>>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const tab = searchParams.get("tab") === "trash" ? "trash" : "list";

  function switchTo(next: "list" | "trash") {
    if (next === tab) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === "trash") params.set("tab", "trash");
    else params.delete("tab");
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `/quotation?${qs}` : "/quotation", {
        scroll: false,
      });
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 border-b border-magic-border">
        <button
          onClick={() => switchTo("list")}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === "list"
              ? "border-magic-red text-magic-red"
              : "border-transparent text-magic-ink/60 hover:text-magic-ink"
          }`}
        >
          Clients &amp; Quotations
        </button>
        <button
          onClick={() => switchTo("trash")}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === "trash"
              ? "border-magic-red text-magic-red"
              : "border-transparent text-magic-ink/60 hover:text-magic-ink"
          }`}
        >
          Trash
        </button>
      </div>
      {tab === "list" ? (
        <QuotationListClient
          isAdmin={isAdmin}
          initialQuotations={initialQuotations}
          initialFolders={initialFolders}
        />
      ) : (
        <TrashView isAdmin={isAdmin} />
      )}
    </div>
  );
}
