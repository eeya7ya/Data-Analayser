"use client";

import { useState } from "react";
import StockChecksTab from "./StockChecksTab";

/**
 * StoragePanel — the storage team's Stock-checks inbox: BOQ availability
 * requests filed from quotations (presales asks "can the warehouse fulfil
 * this BoM?").
 *
 * V1.5A removed the legacy flat inventory tabs (Locations / Stock /
 * Requests) that used to live here. The replacement is the event-sourced,
 * tree-based stock module spec'd in docs/storage-module-v1.5A.md, which
 * lands in the /crm/storage workspace. The stock-checks feature is a
 * quotation feature and is intentionally retained.
 */
export default function StoragePanel() {
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <StockChecksTab onError={setError} />

      {error && (
        <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
