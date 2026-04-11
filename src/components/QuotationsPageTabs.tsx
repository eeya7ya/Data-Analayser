"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
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
 * trash view. IMPORTANT: the current tab is read on the SERVER (from
 * `searchParams` in /quotation/page.tsx) and passed in as a prop. We
 * deliberately do NOT call `useSearchParams()` here — doing so in Next
 * 15 opts the whole subtree into CSR-bailout, which means the
 * server-rendered `initialQuotations` / `initialFolders` props never
 * reach the client and the user briefly sees an empty list while the
 * client re-fetches from /api/quotations on its own. Reading the tab on
 * the server avoids that entirely.
 */
export default function QuotationsPageTabs({
  isAdmin,
  tab,
  initialQuotations,
  initialFolders,
}: {
  isAdmin: boolean;
  tab: "list" | "trash";
  initialQuotations?: Array<Record<string, unknown>>;
  initialFolders?: Array<Record<string, unknown>>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  function switchTo(next: "list" | "trash") {
    if (next === tab) return;
    // Use `replace` (not `push`) so rapidly flipping tabs doesn't stuff
    // dozens of history entries. The `scroll: false` option keeps the
    // page from jumping back to the top on every switch.
    startTransition(() => {
      router.replace(next === "trash" ? "/quotation?tab=trash" : "/quotation", {
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
