"use client";

import { useState } from "react";
import type { SessionUser } from "@/lib/auth";
import CatalogBrowser from "@/components/CatalogBrowser";

/**
 * StorageWorkspace — the CRM → Storage tool surface for Storage people.
 * Two tabs:
 *   • Catalogue — the full product catalogue (browse every product, sort
 *     by any column, build a quotation manually). Reuses the same
 *     CatalogBrowser as /catalog; it self-fetches the system list when
 *     mounted with an empty `initialSystems`.
 *   • Stock Management — placeholder for the V1.5A event-sourced stock
 *     module (docs/storage-module-v1.5A.md); wired up in a later pass.
 *
 * The stock-checks inbox (BOQ availability requests from quotations) lives
 * on /storage and is reached from the dashboard. The legacy flat inventory
 * (Stock / Locations / Requests) was removed in V1.5A.
 */

type Tab = "catalogue" | "stock";

export default function StorageWorkspace({ user }: { user: SessionUser }) {
  const [tab, setTab] = useState<Tab>("catalogue");

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-magic-border mb-4">
        <TabButton active={tab === "catalogue"} onClick={() => setTab("catalogue")}>
          Catalogue
        </TabButton>
        <TabButton active={tab === "stock"} onClick={() => setTab("stock")}>
          Stock Management
        </TabButton>
      </div>

      {tab === "catalogue" && <CatalogBrowser user={user} />}

      {tab === "stock" && (
        <div className="rounded-2xl border border-dashed border-magic-border bg-white p-10 text-center">
          <h2 className="text-lg font-bold text-magic-ink">Stock Management</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-magic-ink/60">
            The V1.5A event-sourced stock module will be configured here.
          </p>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
        active
          ? "border-magic-red text-magic-red"
          : "border-transparent text-magic-ink/60 hover:text-magic-ink"
      }`}
    >
      {children}
    </button>
  );
}
