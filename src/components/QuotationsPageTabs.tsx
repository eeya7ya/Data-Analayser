"use client";

import { useState } from "react";
import QuotationListClient from "@/components/QuotationListClient";
import TrashView from "@/components/TrashView";

/**
 * Small tab switcher on the /quotation page so the Saved Quotations list
 * and the Trash bin can share the same route instead of forcing the user
 * to navigate to a separate page. Keeping it client-side means the
 * quotation list's own client-side data fetch doesn't need to change.
 */
export default function QuotationsPageTabs({ isAdmin }: { isAdmin: boolean }) {
  const [tab, setTab] = useState<"list" | "trash">("list");
  return (
    <div>
      <div className="mb-4 flex items-center gap-2 border-b border-magic-border">
        <button
          onClick={() => setTab("list")}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === "list"
              ? "border-magic-red text-magic-red"
              : "border-transparent text-magic-ink/60 hover:text-magic-ink"
          }`}
        >
          Clients & Quotations
        </button>
        <button
          onClick={() => setTab("trash")}
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
        <QuotationListClient isAdmin={isAdmin} />
      ) : (
        <TrashView isAdmin={isAdmin} />
      )}
    </div>
  );
}
